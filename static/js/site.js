// Copyright 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(function() {

// Auto syntax highlight all pre tags.
function prettyPrintCode() {
  var pres = document.querySelectorAll('pre');
  for (var i = 0, pre; pre = pres[i]; ++i) {
    pre.classList.add('prettyprint');
  }
  window.prettyPrint && prettyPrint();
}

prettyPrintCode();

})();