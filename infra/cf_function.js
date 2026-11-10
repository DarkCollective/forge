// Copyright 2026 Darkcollective, LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Viewer-request function for forge.darkcollective.com. Managed by Terraform
// (infra/site.tf): edit this file and run `terraform apply`.
//
// The site is a tree of static files with directory-style pages (/about/ is
// about/index.html), so a URI naming a directory is pointed at its index.html.
// default_root_object only covers "/". A final segment with no dot is a
// directory: nothing this site serves is extensionless.

function handler(event) {
  var request = event.request;
  request.uri = resolveIndex(request.uri);
  return request;
}

function resolveIndex(uri) {
  if (uri.slice(-1) === "/") {
    return uri + "index.html";
  }
  var lastSegment = uri.slice(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") === -1) {
    return uri + "/index.html";
  }
  return uri;
}
