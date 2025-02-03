package bigquery

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"net/http"
	"io/ioutil"

	bq "cloud.google.com/go/bigquery"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/grafana/sqlds/v3"
	"github.com/pkg/errors"
	"google.golang.org/api/option"

	"github.com/grafana/grafana-bigquery-datasource/pkg/bigquery/api"
	"github.com/grafana/grafana-bigquery-datasource/pkg/bigquery/driver"
	"github.com/grafana/grafana-bigquery-datasource/pkg/bigquery/types"
)

var PluginConfigFromContext = backend.PluginConfigFromContext

type BigqueryDatasourceIface interface {
	sqlds.Driver
	Datasets(ctx context.Context, args DatasetsArgs) ([]string, error)
	TableSchema(ctx context.Context, args TableSchemaArgs) (*types.TableMetadataResponse, error)
	ValidateQuery(ctx context.Context, args ValidateQueryArgs) (*api.ValidateQueryResponse, error)
	Projects(request *http.Request, options ProjectsArgs) ([]string, error)
}

type conn struct {
	db     *sql.DB
	driver *driver.Driver
}

type bqServiceFactory func(ctx context.Context, projectID string, opts ...option.ClientOption) (*bq.Client, error)

type BigQueryDatasource struct {
	connections             sync.Map
	apiClients              sync.Map
	bqFactory               bqServiceFactory
	httpClientService map[string]*http.Client
	url string
}

type ConnectionArgs struct {
	Dataset  string              `json:"dataset,omitempty"`
	Table    string              `json:"table,omitempty"`
	Location string              `json:"location,omitempty"`
	Headers  map[string][]string `json:"grafana-http-headers,omitempty"`
}

func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("http client options: %w", err)
	}
  	opts.ForwardHTTPHeaders = true
	connectionSettings, err := loadSettings(&settings)
	if err != nil {
		return nil, fmt.Errorf("couldn't load connection settings: %w", err)
	}
	opts.Header.Add("Accept-Encoding", "")
	client, err := newHTTPClient(connectionSettings, opts)
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to create http client")
	}
	
	bqClient, err := bq.NewClient(ctx, connectionSettings.DefaultProject, option.WithHTTPClient(client), option.WithEndpoint(connectionSettings.URL))
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to create BigQuery client")
	}

	bqService := bqServiceFactory(func(ctx context.Context, projectID string, opts ...option.ClientOption) (*bq.Client, error) {
		return bqClient, err
	})
	m:= make(map[string]*http.Client)
	m[fmt.Sprintf("%d",settings.ID)] = client
	s := &BigQueryDatasource{
		bqFactory:  bqService,
		httpClientService: m,
		url: connectionSettings.URL,
	}

	ds := sqlds.NewDatasource(s)
	ds.Completable = s
	ds.EnableMultipleConnections = true
	ds.CustomRoutes = newResourceHandler(s).Routes()

	return ds.NewDatasource(ctx, settings)
}

func (s *BigQueryDatasource) Connect(ctx context.Context, config backend.DataSourceInstanceSettings, queryArgs json.RawMessage) (*sql.DB, error) {
	log.DefaultLogger.Debug("Connecting to BigQuery")

	settings, err := loadSettings(&config)
	if err != nil {
		return nil, err
	}
	s.url = settings.URL

	args, err := parseConnectionArgs(queryArgs)
	if err != nil {
		return nil, err
	}

	isQueryArgsSet := args != nil

	connectionSettings := getConnectionSettings(settings, args, isQueryArgsSet)

	connectionKey := fmt.Sprintf("%d/%s:%s", config.ID, connectionSettings.Location, connectionSettings.Project)

	opts, err := config.HTTPClientOptions(ctx)
	if err != nil {
		return nil, err
	}

	c, exists := s.connections.Load(connectionKey)

	if exists {
		connection := c.(conn)
		if !connection.driver.Closed() {
			log.DefaultLogger.Debug("Reusing existing connection to BigQuery")
			return connection.db, nil
		}
	} else {
		log.DefaultLogger.Debug("Creating new connection to BigQuery")
	}

	aC, exists := s.apiClients.Load(connectionKey)

	// If we have already instantiated API client for given connection details then reuse it's underlying big query
	// client for db connection.
	if exists {
		dr, db, err := driver.Open(connectionSettings, aC.(*api.API).Client)
		if err != nil {
			return nil, errors.WithMessage(err, "Failed to connect to database")
		}
		s.connections.Store(connectionKey, conn{db: db, driver: dr})
		if s.httpClientService[fmt.Sprintf("%d", config.ID)] == nil{
			client, err := newHTTPClient(settings, opts)
			if err != nil {
				return nil, errors.WithMessage(err, "Failed to create http client")
			}
			s.httpClientService[fmt.Sprintf("%d", config.ID)] = client
		}
		return db, nil
	} else {
		client, err := newHTTPClient(settings, opts)
		if err != nil {
			return nil, errors.WithMessage(err, "Failed to create http client")
		}

		bqClient, err := s.bqFactory(ctx, connectionSettings.Project, option.WithHTTPClient(client), option.WithEndpoint(settings.URL))
		if err != nil {
			return nil, errors.WithMessage(err, "Failed to create BigQuery client")
		}

		dr, db, err := driver.Open(connectionSettings, bqClient)

		if err != nil {
			return nil, errors.WithMessage(err, "Failed to connect to database")
		}
		s.connections.Store(connectionKey, conn{db: db, driver: dr})
		if s.httpClientService[fmt.Sprintf("%d", config.ID)] == nil{
			s.httpClientService[fmt.Sprintf("%d", config.ID)] = client
		}

		apiInstance := api.New(bqClient)
		apiInstance.SetLocation(connectionSettings.Location)

		if err != nil {
			return nil, errors.WithMessage(err, "Failed to create BigQuery API client")
		}
		s.apiClients.Store(connectionKey, apiInstance)
		return db, nil
	}

}

func (s *BigQueryDatasource) Converters() (sc []sqlutil.Converter) {
	return sc
}

func (s *BigQueryDatasource) FillMode() *data.FillMissing {
	return &data.FillMissing{
		Mode: data.FillModeNull,
	}
}

func (s *BigQueryDatasource) Settings(_ context.Context, _ backend.DataSourceInstanceSettings) sqlds.DriverSettings {
	return sqlds.DriverSettings{
		FillMode: &data.FillMissing{
			Mode: data.FillModeNull,
		},
		ForwardHeaders: true,
	}
}

type DatasetsArgs struct {
	Project  string `json:"project"`
	Location string `json:"location"`
}

func (s *BigQueryDatasource) Datasets(ctx context.Context, options DatasetsArgs) ([]string, error) {
	apiClient, err := s.getApi(ctx, options.Project, options.Location)
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to retrieve BigQuery API client")
	}

	return apiClient.ListDatasets(ctx)
}

type TablesArgs struct {
	Project  string `json:"project"`
	Location string `json:"location"`
	Dataset  string `json:"dataset"`
}

// sqlds.Completable interface
func (s *BigQueryDatasource) Schemas(ctx context.Context, options sqlds.Options) ([]string, error) {
	return nil, nil
}

// sqlds.Completable interface
func (s *BigQueryDatasource) Tables(ctx context.Context, options sqlds.Options) ([]string, error) {
	args := TablesArgs{
		Project:  options["project"],
		Dataset:  options["dataset"],
		Location: options["location"],
	}

	if args.Project == "" || args.Dataset == "" {
		return nil, errors.New("project and dataset must be specified")
	}

	apiClient, err := s.getApi(ctx, args.Project, args.Location)

	if err != nil {
		return nil, errors.WithMessage(err, "Failed to retrieve BigQuery API client")
	}

	return apiClient.ListTables(ctx, args.Dataset)
}

// sqlds.Completable interface
func (s *BigQueryDatasource) Columns(ctx context.Context, options sqlds.Options) ([]string, error) {
	args := TableSchemaArgs{
		Project:  options["project"],
		Dataset:  options["dataset"],
		Table:    options["table"],
		Location: options["location"],
	}

	if args.Project == "" || args.Dataset == "" || args.Table == "" {
		return nil, errors.New("missing required arguments")
	}

	apiClient, err := s.getApi(ctx, args.Project, args.Location)

	if err != nil {
		return nil, errors.WithMessage(err, "Failed to retrieve BigQuery API client")
	}

	isOrderableString := options["isOrderable"]
	isOrderable, err := strconv.ParseBool(isOrderableString)

	if err != nil {
		return nil, errors.WithMessage(err, "Failed to parse isOrderable")
	}

	return apiClient.ListColumns(ctx, args.Dataset, args.Table, isOrderable)
}

type ProjectsArgs struct {
	DatasourceID string `json:"datasourceId"`
}

type Project struct {
	ProjectId   string `json:"id"`
}

type BQProjects struct {
	Projects []Project `json:"projects"`
}

func (s *BigQueryDatasource) Projects(request *http.Request, options ProjectsArgs) ([]string, error) {
	client := s.httpClientService[options.DatasourceID]
	req, err := http.NewRequestWithContext(request.Context(), "GET", fmt.Sprintf("%sprojects",s.url), nil)
	if err != nil {
		return nil, fmt.Errorf("can't format request: %v", err)
	}
	req.Header.Add("Authorization", request.Header.Get("Authorization"))
	req.Header.Add("Accept-Encoding", "")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("client error: %v", err)
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("could not read body: %v", err)
	}
	var projectList BQProjects
	err = json.Unmarshal(body, &projectList)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal body: %v", err)
	}
	var projectNames []string
	for _, proj := range projectList.Projects {
		projectNames = append(projectNames, proj.ProjectId)
	}
	fmt.Println(projectNames)
	return projectNames, nil
}

type ValidateQueryArgs struct {
	Project   string            `json:"project"`
	Location  string            `json:"location"`
	Query     sqlutil.Query     `json:"query"`
	TimeRange backend.TimeRange `json:"range"`
}

func (s *BigQueryDatasource) ValidateQuery(ctx context.Context, options ValidateQueryArgs) (*api.ValidateQueryResponse, error) {
	apiClient, err := s.getApi(ctx, options.Project, options.Location)

	if err != nil {
		return nil, errors.WithMessage(err, "Failed to retrieve BigQuery API client")
	}

	query, err := sqlds.Interpolate(s, &options.Query)

	if err != nil {
		return &api.ValidateQueryResponse{
			IsValid: false,
			IsError: true,
			Error:   "Could not apply macros: " + err.Error(),
		}, nil
	}

	return apiClient.ValidateQuery(ctx, query), nil
}

type TableSchemaArgs struct {
	Project  string `json:"project"`
	Location string `json:"location"`
	Dataset  string `json:"dataset"`
	Table    string `json:"table"`
}

func (s *BigQueryDatasource) TableSchema(ctx context.Context, args TableSchemaArgs) (*types.TableMetadataResponse, error) {
	apiClient, err := s.getApi(ctx, args.Project, args.Location)
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to retrieve BigQuery API client")
	}

	return apiClient.GetTableSchema(ctx, args.Dataset, args.Table)
}

func (s *BigQueryDatasource) getApi(ctx context.Context, project, location string) (*api.API, error) {
	datasourceSettings := getDatasourceSettings(ctx)
	connectionKey := fmt.Sprintf("%d/%s:%s", datasourceSettings.ID, location, project)
	cClient, exists := s.apiClients.Load(connectionKey)

	if exists {
		log.DefaultLogger.Debug("Reusing existing BigQuery API client")
		return cClient.(*api.API), nil
	}

	settings, err := loadSettings(datasourceSettings)
	if err != nil {
		return nil, err
	}

	s.url = settings.URL

	httpOptions, err := datasourceSettings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, err
	}

	httpOptions.ForwardHTTPHeaders = true
	httpOptions.Header.Add("Accept-Encoding", "")

	httpClient, err := newHTTPClient(settings, httpOptions)
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to crate http client")
	}

	client, err := s.bqFactory(ctx, project, option.WithHTTPClient(httpClient), option.WithEndpoint(settings.URL))
	if err != nil {
		return nil, errors.WithMessage(err, "Failed to initialize BigQuery client")
	}
	apiInstance := api.New(client)

	apiInstance.SetLocation(location)

	s.apiClients.Store(connectionKey, apiInstance)

	return apiInstance, nil

}

func getDatasourceSettings(ctx context.Context) *backend.DataSourceInstanceSettings {
	plugin := PluginConfigFromContext(ctx)
	return plugin.DataSourceInstanceSettings
}

func parseConnectionArgs(queryArgs json.RawMessage) (*ConnectionArgs, error) {
	args := &ConnectionArgs{}
	if queryArgs != nil {
		err := json.Unmarshal(queryArgs, args)
		if err != nil {
			return nil, fmt.Errorf("error reading query params: %s", err.Error())
		}
	}
	return args, nil
}
