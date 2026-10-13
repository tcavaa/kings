'use strict';

// An Error carrying the HTTP status the API should answer with. The store and
// the score-sheet checks throw these for bad input; lib/api/http.js sends
// them as `{ error }` with that status.

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const badRequest = (message) => httpError(400, message);

module.exports = { httpError, badRequest };
