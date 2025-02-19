'use strict';
// misc. utilities

//////////////////////////////////
// Utilities for null/undefined //
//////////////////////////////////

// Assert non-null.
// Return the value if it is not null or undefined; otherwise, throw an error.
function nonNull(value) {
  if (value == null) {
    throw new Error('expected a non-null defined value, but got: ' + String(value));
  }
  return value;
}

// Null coalescing: iff the first argument is null or undefined, return the second.
function coalesce(a, b) {
  return (a != null) ? a : b;
}

// Apply a function to a value if non-null, otherwise return the value.
// (Monadic bind for maybe (option) type.)
// ((a -> b), ?a) -> ?b
function applyMaybe(f, x) {
  return (x != null) ? f(x) : x;
}

// Returns the first function result that is not null or undefined.
// Otherwise, returns undefined.
// ((a -> ?b), [a]) -> ?b
function getFirst(f, xs) {
  for (var i = 0; i < xs.length; ++i) {
    var val = f(xs[i]);
    if (val != null) {
      return val;
    }
  }
}

/////////
// DOM //
/////////

/* global document */

/**
 * Concat an array of DOM Nodes into a DocumentFragment.
 * @param  {[Node]} array
 * @return {DocumentFragment}
 */
function toDocFragment(array) {
  var result = document.createDocumentFragment();
  array.forEach(result.appendChild.bind(result));
  return result;
}

///////////////////////
// IE/Edge detection //
///////////////////////

// http://stackoverflow.com/a/9851769
var isBrowserIEorEdge = /*@cc_on!@*/false
  || Boolean(document.documentMode) || Boolean(window.StyleMedia); // eslint-disable-line

//////////////////////////
// Cookie Reload Helper //
//////////////////////////
//TODO turn this into using local storage instead, since that function is already in-built
// https://www.w3schools.com/js/js_cookies.asp
function getCookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for(let i = 0; i <ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) === 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}

function setCookie(cname, cvalue) {
  const d = new Date();
  d.setTime(d.getTime() + (24*60*60*1000));
  var expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

exports.nonNull = nonNull;
exports.coalesce = coalesce;
exports.applyMaybe = applyMaybe;
exports.getFirst = getFirst;

exports.toDocFragment = toDocFragment;

exports.isBrowserIEorEdge = isBrowserIEorEdge;

exports.getCookie = getCookie;
exports.setCookie = setCookie;
