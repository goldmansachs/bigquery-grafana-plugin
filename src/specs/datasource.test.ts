import moment from 'moment';
import { BigQueryDatasource } from '../datasource';
import ResponseParser from '../response_parser';

describe('ResponseParser', () => {
  const response = {
    type: 'table',
    columns: [{text: 'the thing', type: 'string'}],
    rows: [
      { f: [{ v: 'the result!' }] }
    ]
  };

  const actual = ResponseParser._toVar(response);
  expect(actual).toStrictEqual([{"text": "the result!"}]);
});

describe('BigQueryDatasource', () => {
  const instanceSettings = {
    name: 'bigquery',
    jsonData: {
      authenticationType: 'jwt',
      sendUsageData: false,
      defaultProject: 'my-test-project',
      k8s_namespace: 'some-namespace',
      queryableVars: ['defaultProject', 'k8s_namespace']
    },
  };
  const backendSrv = {};
  const $q = {
    all: jest.fn((a) => Promise.all(a))
  };

  const templateSrv = {
    replace: jest.fn(text => text),
  };
  const raw = {
    from: moment.utc('2018-04-25 10:00'),
    to: moment.utc('2018-04-25 11:00'),
  };
  const ctx = {
    backendSrv,
    timeSrvMock: {
      timeRange: () => ({
        from: raw.from,
        to: raw.to,
        raw,
      }),
    },
  } as any;

  beforeEach(() => {
    ctx.ds = new BigQueryDatasource(instanceSettings, backendSrv, $q, templateSrv);
    ctx.ds.projectName = 'my project';
    window.$ = jest.fn(() => ({
      off: jest.fn(() => ({
        on: jest.fn()
      }))
    }));
    window.MutationObserver = jest.fn(() => ({
      observe: jest.fn()
    }));
  });

  describe('proxy service auth', () => {
    test('should correctly handle a proxy service 401', async () => {
      ctx.ds = new BigQueryDatasource(instanceSettings, backendSrv, {}, templateSrv);
      ctx.ds.projectName = 'my project';
      ctx.backendSrv.datasourceRequest = jest.fn().mockImplementation(() => Promise.reject({ status: 401, message: 'Failed to fetch' }));
      try {
        await ctx.ds.doRequest('some/url', 'fakeReqId', 0);
      } catch (e) {
        expect(ctx.backendSrv.datasourceRequest.mock.calls.length).toBe(1);
        expect(e).toStrictEqual({ 
          data: {
            details: '401. Please refresh the token.'
          },
          message: 'Unauthorized: Click this error banner to refresh the token in a new tab, then retry the query.',
          status: 401
         }); 
      }
    });
  });

  describe('formatBigqueryError', () => {
    // Actual error example
    const error = {
        "status": 400,
        "statusText": "",
        "data": {
            "code": 400,
            "message": "SELECT list expression references column timestamp which is neither grouped nor aggregated at [1:8]"
        },
        "config": {
            "data": {
                "priority": "INTERACTIVE",
                "location": "US",
                "query": "SELECT `timestamp` time FROM `my-test-project.playground._deadletter` WHERE  `timestamp` BETWEEN TIMESTAMP_MILLIS (1648749552799) AND TIMESTAMP_MILLIS (1648753152799) GROUP BY process ORDER BY 1 LIMIT 1471",
                "useLegacySql": false,
                "useQueryCache": true
            },
            "method": "POST",
            "requestId": "a1851f19-7a7a-43be-802e-31b6aaccb2d6",
            "url": "https://www.googleapis.com/bigquery/v2/projects/abc-123/queries",
            "withCredentials": true,
            "retry": 0,
            "hideFromInspector": false
        }
    };

    const res = BigQueryDatasource.formatBigqueryError(error);
    expect(res.status).toBe(error.data.code);
    expect(res.message).toBe(error.data.message);
    expect(res.data).toStrictEqual({
      "data": {
        "priority": "INTERACTIVE",
        "location": "US",
        "query": "SELECT `timestamp` time FROM `my-test-project.playground._deadletter` WHERE  `timestamp` BETWEEN TIMESTAMP_MILLIS (1648749552799) AND TIMESTAMP_MILLIS (1648753152799) GROUP BY process ORDER BY 1 LIMIT 1471",
        "useLegacySql": false,
        "useQueryCache": true
      },
      "method": "POST",
      "requestId": "a1851f19-7a7a-43be-802e-31b6aaccb2d6",
      "url": "https://www.googleapis.com/bigquery/v2/projects/abc-123/queries",
      "withCredentials": true,
      "retry": 0,
      "hideFromInspector": false
    });
  });

  describe('_extractFromClause', () => {
    const sql = 'select a from `prj.ds.dt` where';

    const res = BigQueryDatasource._extractFromClause(sql);
    expect(res).toBe('prj.ds.dt');
  });

  describe('_FindTimeField', () => {
    const sql = 'select tm,b from `prj.ds.dt` where';
    const fl = {
      text: 'tm',
    };
    const timeFields = new Array(fl);
    const res = BigQueryDatasource._FindTimeField(sql, timeFields);
    expect(res.text).toBe('tm');
  });

  describe('When performing do request', () => {
    let results;
    const response = {
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'aviv-playground',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };
    beforeEach(() => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
    });

    it('should return env vars for __BQL_ENV select with queryable variable', async () => {
      await ctx.ds.query({ targets: [{ rawSql: 'SELECT defaultProject FROM __BQL_ENV'}] })
      .then(d => {
        expect(d).toStrictEqual({ data: [{ "text": "my-test-project" }] });
      });
    });

    it('should return env vars for __BQL_ENV select with queryable variable (including numbers)', async () => {
      await ctx.ds.query({ targets: [{ rawSql: 'SELECT k8s_namespace FROM __BQL_ENV'}] })
      .then(d => {
        expect(d).toStrictEqual({ data: [{ "text": "some-namespace" }] });
      });
    });

    it('should return a 403 for env vars for __BQL_ENV select with non-queryable variables', async () => {
      await ctx.ds.query({ targets: [{ rawSql: 'SELECT authenticationType FROM __BQL_ENV'}] })
      .catch(e => {
        expect(e).toStrictEqual({
          message: 'Forbidden. This variable does not exist or is not accessible.',
          status: 403
        });
      });
    });

    it('should return expected data', async () => {
      await ctx.ds.doQuery('select * from table', 'id-1').then(data => {
        results = data;
      });
      expect(results.rows.length).toBe(3);
      expect(results.schema.fields.length).toBe(2);
    });

    it('should return expected data batch api', async () => {
      const priority = 'BATCH';
      await ctx.ds.doQuery('select * from table', 'id-1', priority).then(data => {
        results = data;
      });
      expect(results.rows.length).toBe(3);
      expect(results.schema.fields.length).toBe(2);
    });
    it('should return expected data interactive', async () => {
      const priority = 'INTERACTIVE';
      await ctx.ds.doQuery('select * from table', 'id-1', priority).then(data => {
        results = data;
      });
      expect(results.rows.length).toBe(3);
      expect(results.schema.fields.length).toBe(2);
    });

    it('should return expected data interactive', async () => {
      const priority = 'INTERACTIVE';
      await ctx.ds.doQueryRequest('select * from table', 'id-1', priority).then(data => {
        results = data;
      });
      expect(results.data.rows.length).toBe(3);
      expect(results.data.schema.fields.length).toBe(2);
    });

    it('should inject the defaultProject via macro', async () => {
      await ctx.ds.doQuery('select * from $__bqlProject.table', 'id-1', 'INTERACTIVE').then(data => {
        results = data;
      });
      expect(ctx.backendSrv.datasourceRequest.mock.calls.length).toBe(1);
      expect(ctx.backendSrv.datasourceRequest.mock.calls[0][0].data.query).toBe("select * from my-test-project.table");
    });
  });

  describe('_waitForJobComplete', () => {
    let results;
    const response = {
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'aviv-playground',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };
    const queryResults = {
      data: {
        totalBytesProcessed: '23289520',
        jobComplete: false,
        cacheHit: false,
      },
    };
    beforeEach(() => {
      ctx.ds.inflightRequests = {};
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
    });

    it('should return expected data', async () => {
      await ctx.ds._waitForJobComplete(queryResults, 'requestId', 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5').then(data => {
        results = data;
      });
      expect(results.data.rows.length).toBe(3);
      expect(results.data.schema.fields.length).toBe(2);
    });

    it('should add inflight async jobs to the inflightRequests list and cancel existing inflight requests', async () => {
      ctx.ds.inflightRequests = { 'requestId-1': ['asdfasdf', 'adbsbsb12'] };
      ctx.backendSrv.datasourceRequest = jest.fn()
        .mockResolvedValueOnce({ data: { jobComplete: false }, status: 200 })
        .mockResolvedValueOnce({ data: response, status: 200 });
      ctx.ds._cancelInflightRequest = jest.fn().mockResolvedValue({ status: 200 });
      await ctx.ds._waitForJobComplete(queryResults, 'requestId-1', 'abbadabba').then(data => {
        results = data;
      });
      expect(ctx.ds._cancelInflightRequest.mock.calls.length).toBe(2);
      expect(results).not.toBeNull();
    });

    it('should add inflight async jobs to the inflightRequests list and remove upon completion', async () => {
      ctx.backendSrv.datasourceRequest = jest.fn()
        .mockResolvedValueOnce({ data: { jobComplete: false }, status: 200 })
        .mockResolvedValueOnce({ data: response, status: 200 });
      ctx.ds._cancelInflightRequest = jest.fn().mockResolvedValueOnce({ status: 200 });
      await ctx.ds._waitForJobComplete(queryResults, 'requestId-1', 'asdfasdf').then(data => {
        results = data;
      });
      expect(ctx.ds._cancelInflightRequest).not.toHaveBeenCalled();
      expect(results).not.toBeNull();
      expect(ctx.ds.inflightRequests).toStrictEqual({ "requestId-1": [] });
    });
    
    it('should NOT add sync jobs to the inflightRequests list', async () => {
      ctx.ds.inflightRequests = [];
      ctx.backendSrv.datasourceRequest = jest.fn()
        .mockResolvedValueOnce({ data: { jobComplete: true, test: 'yep' }, status: 200 });

      ctx.ds._cancelInflightRequest = jest.fn().mockResolvedValueOnce({ status: 200 });
      await ctx.ds._waitForJobComplete({ data: response }, 'requestId-1', 'asdfasdf').then(data => {
        results = data;
      });
      expect(ctx.ds._cancelInflightRequest).not.toHaveBeenCalled();
      expect(results).not.toBeNull();
    });
  });

  describe('_getQueryResults', () => {
    let results;
    const response = {
      // "pageToken": "token;",
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'aviv-playground',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };
    const queryResults = {
      data: {
        pageToken: 'token;',
        kind: 'bigquery#queryResponse',
        schema: {
          fields: [
            {
              name: 'time',
              type: 'TIMESTAMP',
              mode: 'NULLABLE',
            },
            {
              name: 'start_station_latitude',
              type: 'FLOAT',
              mode: 'NULLABLE',
            },
          ],
        },
        jobReference: {
          projectId: 'aviv-playground',
          jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
          location: 'US',
        },
        totalRows: '3',
        rows: [
          {
            f: [
              {
                v: '1.521578851E9',
              },
              {
                v: '37.7753058',
              },
            ],
          },
          {
            f: [
              {
                v: '1.521578916E9',
              },
              {
                v: '37.3322326',
              },
            ],
          },
          {
            f: [
              {
                v: '1.521578927E9',
              },
              {
                v: '37.781752',
              },
            ],
          },
        ],
        totalBytesProcessed: '23289520',
        jobComplete: true,
        cacheHit: false,
      },
    };
    beforeEach(() => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
    });
    const rows = response.rows;
    it('should return expected data', async () => {
      await ctx.ds._getQueryResults(queryResults, rows, 'requestId', 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5').then(data => {
        results = data;
      });
      expect(results.length).toBe(6);
    });
  });

  describe('When performing getProjects', () => {
    let queryResults;
    const response = {
      kind: 'bigquery#projectList',
      etag: 'o48iuUgjDrXb++kcLl2yeQ==',
      projects: [
        {
          kind: 'bigquery#project',
          id: 'prj-1',
          numericId: '1',
          projectReference: {
            projectId: 'prj-1',
          },
          friendlyName: 'prj-1',
        },
        {
          kind: 'bigquery#project',
          id: 'prj-2',
          numericId: '2',
          projectReference: {
            projectId: 'prj-2',
          },
          friendlyName: 'prj-2',
        },
        {
          kind: 'bigquery#project',
          id: 'prj-3',
          numericId: '3',
          projectReference: {
            projectId: 'prj-3',
          },
          friendlyName: 'prj-3',
        },
      ],
      totalItems: 3,
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds.getProjects().then(data => {
        queryResults = data;
      });
    });

    it('should return list of projects', () => {
      expect(queryResults.length).toBe(3);
      expect(queryResults[0].text).toBe('prj-1');
      expect(queryResults[2].text).toBe('prj-3');
    });
  });

  describe('When performing getDatasets', () => {
    let results;
    const response = {
      kind: 'bigquery#datasetList',
      etag: 'q6TrWWJHEC7v8Vt1T4+geg==',
      datasets: [
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-1',
          datasetReference: {
            datasetId: 'ds-1',
            projectId: 'prj-1',
          },
          location: 'US',
        },
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-2',
          datasetReference: {
            datasetId: 'ds-2',
            projectId: 'prj-1',
          },
          labels: {
            otag: 'ds-2',
          },
          location: 'US',
        },
      ],
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds.getDatasets('prj-1').then(data => {
        results = data;
      });
    });

    it('should return list of datasets', () => {
      expect(results.length).toBe(2);
      expect(results[0].text).toBe('ds-1');
      expect(results[1].text).toBe('ds-2');
    });
  });

  describe('When performing getTables', () => {
    let results;
    const response = {
      kind: 'bigquery#tableList',
      etag: 'Qfgo3cWRRPb3c+XmsrC+OA==',
      tables: [
        {
          kind: 'bigquery#table',
          id: 'prj-1:ds-1.click_64',
          tableReference: {
            projectId: 'prj-1',
            datasetId: 'ds-1',
            tableId: 'click_64',
          },
          type: 'TABLE',
          creationTime: '1525943213994',
        },
        {
          kind: 'bigquery#table',
          id: 'prj-1:ds-1.error',
          tableReference: {
            projectId: 'prj-1',
            datasetId: 'ds-1',
            tableId: 'error',
          },
          type: 'TABLE',
          creationTime: '1525941785282',
        },
      ],
      totalItems: 2,
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds.getTables('prj-1', 'ds-1').then(data => {
        results = data;
      });
    });

    it('should return list of tabels', () => {
      expect(results.length).toBe(2);
      expect(results[0].text).toBe('click_64');
      expect(results[1].text).toBe('error');
    });
  });

  describe('When performing getTableFields for Date Fields', () => {
    let results;
    const response = {
      kind: 'bigquery#table',
      etag: '3UHbvhc/35v2P8ZhsjrRtw==',
      id: 'ds-1:ds-1.newtable',
      selfLink: 'https://content.googleapis.com/bigquery/v2/projects/ds-1/datasets/ds-1/tables/newtable',
      tableReference: {
        projectId: 'ds-1',
        datasetId: 'ds-1',
        tableId: 'newtable',
      },
      description: 'a table partitioned by transaction_date',
      schema: {
        fields: [
          {
            name: 'transaction_id',
            type: 'INTEGER',
          },
          {
            name: 'transaction_date',
            type: 'DATE',
          },
          {
            name: 'My_datetime',
            type: 'DATETIME',
          },
          {
            name: 'My_Timestamp',
            type: 'TIMESTAMP',
          },
          {
            name: 'My_STRING',
            type: 'STRING',
          },
        ],
      },
      timePartitioning: {
        type: 'DAY',
        expirationMs: '259200000',
        field: 'transaction_date',
      },
      numBytes: '0',
      numLongTermBytes: '0',
      numRows: '0',
      creationTime: '1551211795415',
      lastModifiedTime: '1551623603909',
      type: 'TABLE',
      location: 'US',
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds.getTableFields('prj-1', 'ds-1', 'newtable', ['DATE', 'TIMESTAMP', 'DATETIME']).then(data => {
        results = data;
      });
    });

    it('should return list of dare fields', () => {
      expect(results.length).toBe(3);
      expect(results[0].text).toBe('transaction_date');
      expect(results[1].text).toBe('My_datetime');
      expect(results[2].text).toBe('My_Timestamp');
    });
  });
  
  describe('When performing getTableFields for Numeric Fields', () => {
    let results;
    const response = {
      kind: 'bigquery#table',
      etag: '3UHbvhc/35v2P8ZhsjrRtw==',
      id: 'ds-1:ds-1.newtable',
      selfLink: 'https://content.googleapis.com/bigquery/v2/projects/ds-1/datasets/ds-1/tables/newtable',
      tableReference: {
        projectId: 'ds-1',
        datasetId: 'ds-1',
        tableId: 'newtable',
      },
      description: 'a table partitioned by transaction_date',
      schema: {
        fields: [
          {
            name: 'transaction_id',
            type: 'INTEGER',
          },
          {
            name: 'transaction_date',
            type: 'DATE',
          },
          {
            name: 'My_datetime',
            type: 'DATETIME',
          },
          {
            name: 'My_Timestamp',
            type: 'TIMESTAMP',
          },
          {
            name: 'My_STRING',
            type: 'STRING',
          },
          {
            name: 'My_FLOAT',
            type: 'FLOAT64',
          },
        ],
      },
      timePartitioning: {
        type: 'DAY',
        expirationMs: '259200000',
        field: 'transaction_date',
      },
      numBytes: '0',
      numLongTermBytes: '0',
      numRows: '0',
      creationTime: '1551211795415',
      lastModifiedTime: '1551623603909',
      type: 'TABLE',
      location: 'US',
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds
        .getTableFields('prj-1', 'ds-1', 'newtable', ['INT64', 'NUMERIC', 'FLOAT64', 'FLOAT', 'INT', 'INTEGER'])
        .then(data => {
          results = data;
        });
    });

    it('should return list of numeric', () => {
      expect(results.length).toBe(2);
      expect(results[0].text).toBe('transaction_id');
      expect(results[1].text).toBe('My_FLOAT');
    });
  });

  describe('When performing getTableFields for All Fields', () => {
    let results;
    const response = {
      kind: 'bigquery#table',
      etag: '3UHbvhc/35v2P8ZhsjrRtw==',
      id: 'ds-1:ds-1.newtable',
      selfLink: 'https://content.googleapis.com/bigquery/v2/projects/ds-1/datasets/ds-1/tables/newtable',
      tableReference: {
        projectId: 'ds-1',
        datasetId: 'ds-1',
        tableId: 'newtable',
      },
      description: 'a table partitioned by transaction_date',
      schema: {
        fields: [
          {
            name: 'transaction_id',
            type: 'INTEGER',
          },
          {
            name: 'transaction_date',
            type: 'DATE',
          },
          {
            name: 'My_datetime',
            type: 'DATETIME',
          },
          {
            name: 'My_Timestamp',
            type: 'TIMESTAMP',
          },
          {
            name: 'My_STRING',
            type: 'STRING',
          },
          {
            name: 'My_FLOAT',
            type: 'FLOAT64',
          },
        ],
      },
      timePartitioning: {
        type: 'DAY',
        expirationMs: '259200000',
        field: 'transaction_date',
      },
      numBytes: '0',
      numLongTermBytes: '0',
      numRows: '0',
      creationTime: '1551211795415',
      lastModifiedTime: '1551623603909',
      type: 'TABLE',
      location: 'US',
    };

    beforeEach(async () => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
      await ctx.ds.getTableFields('prj-1', 'ds-1', 'newtable', []).then(data => {
        results = data;
      });
    });

    it('should return list of all fields', () => {
      expect(results.length).toBe(6);
      expect(results[0].text).toBe('transaction_id');
      expect(results[5].text).toBe('My_FLOAT');
    });
  });
  
  describe('When interpolating variables', () => {
    beforeEach(() => {
      ctx.variable = {};
    });

    describe('and value is a string', () => {
      it('should return an unquoted value', () => {
        expect(ctx.ds.interpolateVariable('abc', ctx.variable)).toEqual('abc');
      });
    });
    describe('and value is a number', () => {
      it('should return an unquoted value', () => {
        expect(ctx.ds.interpolateVariable(1000, ctx.variable)).toEqual(1000);
      });
    });
    describe('and value is an array of strings', () => {
      it('should return comma separated quoted values', () => {
        expect(ctx.ds.interpolateVariable(['a', 'b', 'c'], ctx.variable)).toEqual("'a','b','c'");
      });
    });

    describe('and variable allows multi-value and is a string', () => {
      it('should return a quoted value', () => {
        ctx.variable.multi = true;
        expect(ctx.ds.interpolateVariable('abc', ctx.variable)).toEqual("'abc'");
      });
    });

    describe('and variable contains single quote', () => {
      it('should return a quoted value', () => {
        ctx.variable.multi = true;
        expect(ctx.ds.interpolateVariable("a'bc", ctx.variable)).toEqual("'a''bc'");
        expect(ctx.ds.interpolateVariable("a'b'c", ctx.variable)).toEqual("'a''b''c'");
      });
    });

    describe('and variable allows all and is a string', () => {
      it('should return a quoted value', () => {
        ctx.variable.includeAll = true;
        expect(ctx.ds.interpolateVariable('abc', ctx.variable)).toEqual("'abc'");
      });
    });
  });
  
  describe('When performing parseDataQuery for table', () => {
    let results;
    const response = {
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'proj-1',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };

    results = ResponseParser.parseDataQuery(response, 'table');
    it('should return a table', () => {
      expect(results.columns.length).toBe(2);
      expect(results.rows.length).toBe(3);
      expect(results.columns[0].text).toBe('time');
      expect(results.columns[0].type).toBe('TIMESTAMP');
    });
  });

  describe('ResponseParser', () => {
    it('transformAnnotationResponse empty results with 0 rows', () => {
      const fields = [
        {
          name: 'time',
          type: 'TIMESTAMP',
          mode: 'NULLABLE',
        },
        {
          name: 'text',
          type: 'FLOAT',
          mode: 'NULLABLE',
        },
        {
          name: 'tags',
          type: 'FLOAT',
          mode: 'NULLABLE',
        },
      ];
      const options = { annotation: {} };
      const data = { data: { schema: { fields } } };
      const p = new Promise((reject, resolve) => { });
      const rp = new ResponseParser(p);
      const list = rp.transformAnnotationResponse(options, data);
      expect(list.length).toBe(0);
    });
    it('transformAnnotationResponse empty results without rows', () => {
      const fields = [
        {
          name: 'time',
          type: 'TIMESTAMP',
          mode: 'NULLABLE',
        },
        {
          name: 'text',
          type: 'FLOAT',
          mode: 'NULLABLE',
        },
        {
          name: 'tags',
          type: 'FLOAT',
          mode: 'NULLABLE',
        },
      ];
      const options = { annotation: {} };
      const data = { data: { schema: { fields } } };
      const p = new Promise((reject, resolve) => { });
      const rp = new ResponseParser(p);
      const list = rp.transformAnnotationResponse(options, data);
      expect(list.length).toBe(0);
    });
    it('transformAnnotationResponse results with 3 rows', () => {
      const rows = [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
            {
              v: '42.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
            {
              v: '42.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
            {
              v: '42.7753058',
            },
          ],
        },
      ],
        fields = [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'text',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
          {
            name: 'tags',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ];
      const options = { annotation: {} };
      const data = { data: { schema: { fields }, rows } };
      const p = new Promise((reject, resolve) => { });
      const rp = new ResponseParser(p);
      const list = rp.transformAnnotationResponse(options, data);
      expect(list.length).toBe(3);
    });
  });
  
  describe('When performing parseDataQuery for time_series', () => {
    let results;
    const response = {
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'proj-1',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };

    results = ResponseParser.parseDataQuery(response, 'time_series');
    it('should return a time_series', () => {
      expect(results[0].datapoints.length).toBe(3);
      expect(results[0].datapoints[0][0]).toBe(37.7753058);
      expect(results[0].datapoints[0][1]).toBe(1521578851000);
      expect(results[0].datapoints[2][0]).toBe(37.781752);
      expect(results[0].datapoints[2][1]).toBe(1521578927000);
    });
  });

  describe('When performing parseDataQuery for vars', () => {
    let results;
    const response = {
      kind: 'bigquery#queryResponse',
      schema: {
        fields: [
          {
            name: 'time',
            type: 'TIMESTAMP',
            mode: 'NULLABLE',
          },
          {
            name: 'start_station_latitude',
            type: 'FLOAT',
            mode: 'NULLABLE',
          },
        ],
      },
      jobReference: {
        projectId: 'proj-1',
        jobId: 'job_fB4qCDAO-TKg1Orc-OrkdIRxCGN5',
        location: 'US',
      },
      totalRows: '3',
      rows: [
        {
          f: [
            {
              v: '1.521578851E9',
            },
            {
              v: '37.7753058',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578916E9',
            },
            {
              v: '37.3322326',
            },
          ],
        },
        {
          f: [
            {
              v: '1.521578927E9',
            },
            {
              v: '37.781752',
            },
          ],
        },
      ],
      totalBytesProcessed: '23289520',
      jobComplete: true,
      cacheHit: false,
    };

    results = ResponseParser.parseDataQuery(response, 'var');
    it('should return a var', () => {
      expect(results.length).toBe(3);
      expect(results[0].text).toBe('1.521578851E9');
    });
  });

  describe('When performing testDatasource', () => {
    let results;
    const response = {
      kind: 'bigquery#datasetList',
      etag: 'q6TrWWJHEC7v8Vt1T4+geg==',
      datasets: [
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-1',
          datasetReference: {
            datasetId: 'ds-1',
            projectId: 'prj-1',
          },
          location: 'US',
        },
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-2',
          datasetReference: {
            datasetId: 'ds-2',
            projectId: 'prj-1',
          },
          labels: {
            otag: 'ds-2',
          },
          location: 'US',
        },
      ],
    };

    beforeEach(() => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
    });

    it('should test datasource', async () => {
      await ctx.ds.testDatasource().then(data => {
        results = data;
      });
      expect(results.status).toBe('success');
    });
  });
  
  describe('When performing testDatasource', () => {
    let results;
    const response = {
      kind: 'bigquery#datasetList',
      etag: 'q6TrWWJHEC7v8Vt1T4+geg==',
      datasets: [
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-1',
          datasetReference: {
            datasetId: 'ds-1',
            projectId: 'prj-1',
          },
          location: 'US',
        },
        {
          kind: 'bigquery#dataset',
          id: 'prj-1:ds-2',
          datasetReference: {
            datasetId: 'ds-2',
            projectId: 'prj-1',
          },
          labels: {
            otag: 'ds-2',
          },
          location: 'US',
        },
      ],
    };

    beforeEach(() => {
      ctx.backendSrv.datasourceRequest = jest.fn(options => {
        return Promise.resolve({ data: response, status: 200 });
      });
    });
    it('should return  default projects', () => {
      results = ctx.ds.getDefaultProject();
    });
    expect(results).toBe(undefined);
  });
});
