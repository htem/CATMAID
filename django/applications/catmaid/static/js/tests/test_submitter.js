/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

QUnit.test('Submitter test', function( assert ) {
  // Don't run this test in PhantomJS, because ES6 Promises are not yet
  // supported, it seems.
  if (CATMAID.tests.runByPhantomJS()) {
    assert.expect(0);
    return;
  }

  // Test chaining promises and maintaining order
  (function() {
    var results = [];
    var done = assert.async();
    var submit = submitterFn();
    submit.then(createSleepPromise.bind(this, 1000, 1, results, false));
    submit.then(createSleepPromise.bind(this, 10, 2, results, false));
    submit.then(function() {
      assert.deepEqual(results, [1,2],
          "Submitter execute promises in expected order");
      done();
    });
  })();

  // Test rejection behavior by letting first promise fail and expect the second
  // one not to run.
  (function() {
    var results = [];
    var done = assert.async();
    var submit = submitterFn();
    submit.then(createSleepPromise.bind(this, 1000, 1, results, true));
    submit.then(createSleepPromise.bind(this, 10, 2, results, false));
    submit.then(function() {
      // This should not be executed and will raise an error.
      assert.ok(false,
          "Submitter doesn't execute functions if earlier promise fails");
      done();
    });
    // Add result check as error callback
    submit(null, null, null, false, false, function() {
      assert.deepEqual(results, [],
          "Submitter resets if earlier promise fails");
      done();
    });
  })();

  // Test result propagation
  (function() {
    var results = [];
    var done1 = assert.async();
    var done2 = assert.async();
    var done3 = assert.async();
    var done4 = assert.async();
    var submit = submitterFn();
    submit.then(function(value) {
      assert.strictEqual(value, undefined,
          "Submitter is initialized with no last result.");
      done1();
      return "test";
    });
    submit.then(function(value) {
      assert.strictEqual(value, "test",
          "Submitter propageds promise return values, if used as a promise.");
      done2();
    });
    submit.then(createSleepPromise.bind(this, 1000, 1, results, false));
    submit.then(function(value) {
      assert.strictEqual(value, 1,
          "Submitter propageds promise return values, if used as a promise.");
      done3();
    });
    submit.then(createSleepPromise.bind(this, 10, 2, results, false));
    submit.then(function(value) {
      assert.strictEqual(value, 2,
          "Submitter propageds promise return values, if used as a promise.");
      done4();
    });
  })();

  /**
  * Creates a promise that will sleep for some time before it is resolved. The
  * promise will write their value to the resilts array passed as argument
  * when they are executed. The promise is rejected if fail is truthy.
  */
  function createSleepPromise(milliseconds, value, results, fail) {
    return new Promise(function(resolve, reject) {
      if (fail) {
        reject("I was asked to fail");
      } else {
        setTimeout(function() {
          results.push(value);
          resolve(value);
        }, milliseconds);
      }
    });
  }

});
