package bigquery

import (
	"net/http"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
)


func newHTTPClient(opts httpclient.Options) (*http.Client, error) {
	return httpclient.New(opts)
}

