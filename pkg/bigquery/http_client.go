package bigquery

import (
	"net/http"

	"github.com/grafana/grafana-bigquery-datasource/pkg/bigquery/types"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
)


func newHTTPClient(settings types.BigQuerySettings, opts httpclient.Options) (*http.Client, error) {
	return httpclient.New(opts)
}

