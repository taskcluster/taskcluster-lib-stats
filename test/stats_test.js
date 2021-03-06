suite('stats', function() {
  var config        = require('taskcluster-lib-config');
  var stats         = require('../lib/stats');
  var assert        = require('assert');
  var _             = require('lodash');
  var Promise       = require('promise');
  var debug         = require('debug')('test:stats_test');

  // Load necessary configuration
  var cfg = config({
    envs: [
      'influxdb_connectionString',
    ],
    filename:               'taskcluster-base-test'
  });

  if (!cfg.get('influxdb:connectionString')) {
    throw new Error("Skipping 'stats', missing config file: " +
                    "taskcluster-base-test.conf.json");
    return;
  }

  test("Create Series", function() {
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        method:           stats.types.String,
        duration:         stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });
  });

  test("Create Influx", function() {
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });
  });

  test("Submit to influx", function() {
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });
    influx.addPoint('TestSeries', {
      colA:   'A',
      colB:   123
    });
    return influx.close().then(function() {
      assert(influx.pendingPoints() === 0, "Points should be submitted");
    });
  });

  test("Submit to influx (by timeout)", function() {
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString'),
      maxDelay:           1
    });
    influx.addPoint('TestSeries', {
      colA:   'A',
      colB:   123
    });
    return new Promise(function(accept) {
      setTimeout(accept, 1500);
    }).then(function() {
      assert(influx.pendingPoints() === 0, "Points should be submitted");
    });
  });

  test("Query influx", function() {
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });
    influx.addPoint('TestSeries', {
      colA:   'A',
      colB:   123
    });

    var p = influx.flush();

    p = p.then(function() {
      assert(influx.pendingPoints() === 0, "Points should be submitted");
    });

    p = p.then(function() {
      return influx.query('select * from TestSeries');
    });

    p = p.then(function(result) {
      assert(result[0].name === 'TestSeries');
      assert(result[0].points);
      assert(result[0].points.length >= 1);
      return result;
    });

    return p;
  });

  test("Create reporter", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    // Report with reporter
    reporter({
      colA:   'A',
      colB:   123
    });

    assert(influx.pendingPoints() === 1, "We should have 1 point");
    return influx.close().then(function() {
      assert(influx.pendingPoints() === 0, "Points should be submitted");
    });
  });

  test("Create reporter (with NullDrain)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create statistics drain with NullDrain
    var drain = new stats.NullDrain();

    // Create reporter
    var reporter = TestSeries.reporter(drain);

    // Report with reporter
    reporter({
      colA:   'A',
      colB:   123
    });

    assert(drain.pendingPoints() === 1, "We should have 1 point");
    return drain.close().then(function() {
      assert(drain.pendingPoints() === 0, "Points should be submitted");
    });
  });

  test("Create reporter (with tags)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      }
    });

    // Create statistics drain with NullDrain
    var drain = new stats.NullDrain();

    // Create reporter
    var reporter = TestSeries.reporter(drain, {
      colA: 'my-tag'
    });

    var lastPoint = null;
    drain.on('point', function(series, point) {
      assert(lastPoint === null, "Only expected one point");
      lastPoint = point;
    });

    // Report with reporter
    reporter({
      colB:   123
    });

    assert(drain.pendingPoints() === 1, "We should have 1 point");
    assert(lastPoint, "Expected a lastPoint");
    assert(lastPoint.colB === 123, "Expected 123 from colB");
    assert(lastPoint.colA === 'my-tag', "Expected tag to be present");
  });

  test("Create reporter (with tags - overwrite tag)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      }
    });

    // Create statistics drain with NullDrain
    var drain = new stats.NullDrain();

    // Create reporter
    var reporter = TestSeries.reporter(drain, {
      colA: 'my-tag'
    });

    var lastPoint = null;
    drain.on('point', function(series, point) {
      assert(lastPoint === null, "Only expected one point");
      lastPoint = point;
    });

    // Report with reporter
    reporter({
      colB: 123,
      colA: 'my-tag2'
    });

    assert(drain.pendingPoints() === 1, "We should have 1 point");
    assert(lastPoint, "Expected a lastPoint");
    assert(lastPoint.colB === 123, "Expected 123 from colB");
    assert(lastPoint.colA === 'my-tag2', "Expected tag to be present");
  });

  test("Report wrong columns", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    var err;
    try {
      // Report with reporter
      reporter({
        colA:   123,
        colB:   123
      });
    }
    catch(e) {
      err = e;
    }

    assert(err, "Expected an error");
    assert(influx.pendingPoints() === 0, "We should have 0 points");
  });

  test("Report wrong columns (again)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    var err;
    try {
      // Report with reporter
      reporter({
        colA:   'strgin',
        colB:   'dsfsdf'
      });
    }
    catch(e) {
      err = e;
    }

    assert(err, "Expected an error");
    assert(influx.pendingPoints() === 0, "We should have 0 points");
  });

  test("Report additional columns", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    // Report with reporter
    reporter({
      colA:   'A',
      colB:   123,
      colAdd: 'string'
    });

    assert(influx.pendingPoints() === 1, "We should have 1 point");
    return influx.close().then(function() {
      assert(influx.pendingPoints() === 0, "Points should be submitted");
    });
  });

  test("Report additional columns (wrong type)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      },
      additionalColumns:  stats.types.String,
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    var err;
    try {
      // Report with reporter
      reporter({
        colA:   'A',
        colB:   123,
        colAdd: 34545
      });
    }
    catch(e) {
      err = e;
    }

    assert(err, "Expected an error");
    assert(influx.pendingPoints() === 0, "We should have 0 points");
  });

  test("Report additional columns (not allowed)", function() {
    // Create test series
    var TestSeries = new stats.Series({
      name:               'TestSeries',
      columns: {
        colA:             stats.types.String,
        colB:             stats.types.Number,
      }
    });

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Create reporter
    var reporter = TestSeries.reporter(influx);

    var err;
    try {
      // Report with reporter
      reporter({
        colA:   'A',
        colB:   123,
        colAdd: "string"
      });
    }
    catch(e) {
      err = e;
    }

    assert(err, "Expected an error");
    assert(influx.pendingPoints() === 0, "We should have 0 points");
  });

  test("startProcessUsageReporting (and stop)", function() {
    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Start monitoring
    stats.startProcessUsageReporting({
      drain:      influx,
      interval:   0.1,
      component:  'taskcluster-stats-test',
      process:    'mocha'
    });

    return new Promise(function(accept) {
      setTimeout(accept, 400);
    }).then(function() {
      assert(influx.pendingPoints() >= 2, "We should have at least 2 points");
      stats.stopProcessUsageReporting();
    });
  });

  test("startProcessUsageReporting (twice)", function() {
    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Start monitoring
    stats.startProcessUsageReporting({
      drain:      influx,
      interval:   0.1,
      component:  'taskcluster-stats-test',
      process:    'mocha'
    });

    // Start monitoring
    stats.startProcessUsageReporting({
      drain:      influx,
      interval:   0.1,
      component:  'taskcluster-stats-test',
      process:    'mocha'
    });

    return new Promise(function(accept) {
      setTimeout(accept, 400);
    }).then(function() {
      assert(influx.pendingPoints() >= 2, "We should have at least 2 points");
      stats.stopProcessUsageReporting();
    });
  });

  // We don't have taskcluster-client to play with here, so instead we'll rely
  // on a hardcoded message to write tests.
  var EXAMPLE_MESSAGE = {
    "payload": {
      "status": {
        "taskId": "5yfpbMMqSmSQ86t83vMZxA",
        "provisionerId": "aws-provisioner",
        "workerType": "cli",
        "schedulerId": "-",
        "taskGroupId": "5yfpbMMqSmSQ86t83vMZxA",
        "priority": 3,
        "deadline": "2014-09-05T00:49:58.600Z",
        "retriesLeft": 5,
        "state": "completed",
        "runs": [
          {
            "runId": 0,
            "state": "completed",
            "reasonCreated": "scheduled",
            "scheduled": "2014-09-05T00:20:03.022Z",
            "reasonResolved": "completed",
            "success": true,
            "workerGroup": "us-west-2c",
            "workerId": "i-b2c169bd",
            "takenUntil": "2014-09-05T00:40:04.185Z",
            "started": "2014-09-05T00:20:04.188Z",
            "resolved": "2014-09-05T00:20:15.472Z"
          }
        ]
      },
      "runId": 0,
      "success": true,
      "workerGroup": "us-west-2c",
      "workerId": "i-b2c169bd",
      "version": 1
    },
    "exchange": "queue/v1/task-completed",
    "routingKey": "primary.5yfpbMMqSmSQ86t83vMZxA.0.us-west-2c.i-b2c169bd.aws-provisioner.cli.-.5yfpbMMqSmSQ86t83vMZxA._",
    "redelivered": false
  };

  test("createHandlerTimer", function() {
    // Create message
    var message = _.cloneDeep(EXAMPLE_MESSAGE);

    // Create a message handler that waits 250 ms
    var handler = function() {
      return new Promise(function(accept) {
        setTimeout(accept, 250);
      });
    };

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Wrap handler
    var timedHandler = stats.createHandlerTimer(handler, {
      drain:        influx,
      component:    'taskcluster-stats-test'
    });

    // Test that nothing has been reported yet
    assert(influx.pendingPoints() === 0, "We shouldn't have any points");

    // Test the timed handler
    return timedHandler(message).then(function() {
      assert(influx.pendingPoints() === 1, "We should have one point");
    });
  });

  test("createHandlerTimer (error)", function() {
    // Create message
    var message = _.cloneDeep(EXAMPLE_MESSAGE);

    // Create a message handler that waits 250 ms
    var handler = function() {
      return new Promise(function(accept) {
        setTimeout(accept, 250);
      }).then(function() {
        throw new Error("An expected error");
      });
    };

    // Create InfluxDB connection
    var influx = new stats.Influx({
      connectionString:   cfg.get('influxdb:connectionString')
    });

    // Wrap handler
    var timedHandler = stats.createHandlerTimer(handler, {
      drain:        influx,
      component:    'taskcluster-stats-test'
    });

    // Test that nothing has been reported yet
    assert(influx.pendingPoints() === 0, "We shouldn't have any points");

    // Test the timed handler
    return timedHandler(message).then(function() {
      assert(false, "We should have got an error!");
    }, function(err) {
      debug("Expected error: %j", err);
    }).then(function() {
      assert(influx.pendingPoints() === 1, "We should have one point");
    });
  });

  test("createAPIClientStatsHandler", function() {
    // Create statistics drain with NullDrain
    var drain = new stats.NullDrain();

    // Create handler to test
    var handler = stats.createAPIClientStatsHandler({
      drain: drain,
      tags: {
        component: 'base-tests',
        process: 'mocha',
        provisionerId: 'no-provisioner',
        workerType: 'dummy-base-test',
        workerGroup: 'not-a-worker',
        workerId: 'not-a-worker'
      }
    });

    assert(drain.pendingPoints() === 0, "We should have zero points");

    handler({
      duration: 6230,
      retries: 5,
      method: 'getConnectionError',
      success: 0,
      resolution: 'ECONNRESET',
      target: 'Unknown',
      baseUrl: 'http://localhost:60526/v1'
    });

    assert(drain.pendingPoints() === 1, "We should have one point");
  });

  test("createAPIClientStatsHandler (illegal columns)", function() {
    // Create statistics drain with NullDrain
    var drain = new stats.NullDrain();

    try {
      stats.createAPIClientStatsHandler({
        drain: drain,
        tags: {
          component: 'base-tests',
          process: 'mocha',
          method: 'can-t-declare-this'
        }
      });
    } catch (err) {
      assert(err, "Expected an error");
      return;
    }
    assert(false, "Expected an error!");
  });
});


