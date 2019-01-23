/**
 * The main bootstrap script for loading pyodide.
 */

var languagePluginLoader = new Promise((resolve, reject) => {
  // This is filled in by the Makefile to be either a local file or the
  // deployed location. TODO: This should be done in a less hacky
  // way.
  const baseURL = 'https://keno.github.io/julia-wasm/website/';

  ////////////////////////////////////////////////////////////
  // Package loading
  let loadedPackages = new Array();
  var loadPackagePromise = new Promise((resolve) => resolve());
  // Regexp for validating package name and URI
  var package_name_regexp = '[a-z0-9_][a-z0-9_\-]*'
  var package_uri_regexp =
      new RegExp('^https?://.*?(' + package_name_regexp + ').js$', 'i');
  var package_name_regexp = new RegExp('^' + package_name_regexp + '$', 'i');

  let _uri_to_package_name = (package_uri) => {
    // Generate a unique package name from URI

    if (package_name_regexp.test(package_uri)) {
      return package_uri;
    } else if (package_uri_regexp.test(package_uri)) {
      let match = package_uri_regexp.exec(package_uri);
      // Get the regexp group corresponding to the package name
      return match[1];
    } else {
      return null;
    }
  };

  // clang-format off
  let preloadWasm = () => {
    // On Chrome, we have to instantiate wasm asynchronously. Since that
    // can't be done synchronously within the call to dlopen, we instantiate
    // every .so that comes our way up front, caching it in the
    // `preloadedWasm` dictionary.

    let promise = new Promise((resolve) => resolve());
    let FS = pyodide._module.FS;

    function recurseDir(rootpath) {
      let dirs;
      try {
        dirs = FS.readdir(rootpath);
      } catch {
        return;
      }
      for (entry of dirs) {
        if (entry.startsWith('.')) {
          continue;
        }
        const path = rootpath + entry;
        if (entry.endsWith('.so')) {
          if (Module['preloadedWasm'][path] === undefined) {
            promise = promise
              .then(() => Module['loadWebAssemblyModule'](
                FS.readFile(path), true))
              .then((module) => {
                Module['preloadedWasm'][path] = module;
              });
          }
        } else if (FS.isDir(FS.lookupPath(path).node.mode)) {
          recurseDir(path + '/');
        }
      }
    }

    recurseDir('/');

    return promise;
  }
  // clang-format on

  let _loadPackage = (names, messageCallback) => {
    // DFS to find all dependencies of the requested packages
    let packages = window.pyodide._module.packages.dependencies;
    let loadedPackages = window.pyodide.loadedPackages;
    let queue = [].concat(names || []);
    let toLoad = new Array();
    while (queue.length) {
      let package_uri = queue.pop();

      const package = _uri_to_package_name(package_uri);

      if (package == null) {
        console.error(`Invalid package name or URI '${package_uri}'`);
        return;
      } else if (package == package_uri) {
        package_uri = 'default channel';
      }

      if (package in loadedPackages) {
        if (package_uri != loadedPackages[package]) {
          console.error(`URI mismatch, attempting to load package ` +
                        `${package} from ${package_uri} while it is already ` +
                        `loaded from ${loadedPackages[package]}!`);
          return;
        }
      } else if (package in toLoad) {
        if (package_uri != toLoad[package]) {
          console.error(`URI mismatch, attempting to load package ` +
                        `${package} from ${package_uri} while it is already ` +
                        `being loaded from ${toLoad[package]}!`);
          return;
        }
      } else {
        console.log(`Loading ${package} from ${package_uri}`);

        toLoad[package] = package_uri;
        if (packages.hasOwnProperty(package)) {
          packages[package].forEach((subpackage) => {
            if (!(subpackage in loadedPackages) && !(subpackage in toLoad)) {
              queue.push(subpackage);
            }
          });
        } else {
          console.log(`Unknown package '${package}'`);
        }
      }
    }

    window.pyodide._module.locateFile = (path) => {
      // handle packages loaded from custom URLs
      let package = path.replace(/\.data$/, "");
      if (package in toLoad) {
        let package_uri = toLoad[package];
        if (package_uri != 'default channel') {
          return package_uri.replace(/\.js$/, ".data");
        };
      };
      return baseURL + path;
    };

    let promise = new Promise((resolve, reject) => {
      if (Object.keys(toLoad).length === 0) {
        resolve('No new packages to load');
        return;
      }

      const packageList = Array.from(Object.keys(toLoad)).join(', ');
      if (messageCallback !== undefined) {
        messageCallback(`Loading ${packageList}`);
      }

      window.pyodide._module.monitorRunDependencies = (n) => {
        if (n === 0) {
          for (let package in toLoad) {
            window.pyodide.loadedPackages[package] = toLoad[package];
          }
          delete window.pyodide._module.monitorRunDependencies;
          if (!isFirefox) {
            preloadWasm().then(() => {resolve(`Loaded ${packageList}`)});
          } else {
            resolve(`Loaded ${packageList}`);
          }
        }
      };

      for (let package in toLoad) {
        let script = document.createElement('script');
        let package_uri = toLoad[package];
        if (package_uri == 'default channel') {
          script.src = `${baseURL}${package}.js`;
        } else {
          script.src = `${package_uri}`;
        }
        script.onerror = (e) => { reject(e); };
        document.body.appendChild(script);
      }

      // We have to invalidate Python's import caches, or it won't
      // see the new files. This is done here so it happens in parallel
      // with the fetching over the network.
      window.pyodide.runPython('import importlib as _importlib\n' +
                               '_importlib.invalidate_caches()\n');
    });

    if (window.iodide !== undefined) {
      window.iodide.evalQueue.await([ promise ]);
    }

    return promise;
  };

  let loadPackage = (names, messageCallback) => {
    /* We want to make sure that only one loadPackage invocation runs at any
     * given time, so this creates a "chain" of promises. */
    loadPackagePromise =
        loadPackagePromise.then(() => _loadPackage(names, messageCallback));
    return loadPackagePromise;
  };

  ////////////////////////////////////////////////////////////
  // Fix Python recursion limit
  function fixRecursionLimit(pyodide) {
    // The Javascript/Wasm call stack may be too small to handle the default
    // Python call stack limit of 1000 frames. This is generally the case on
    // Chrom(ium), but not on Firefox. Here, we determine the Javascript call
    // stack depth available, and then divide by 50 (determined heuristically)
    // to set the maximum Python call stack depth.

    let depth = 0;
    function recurse() {
      depth += 1;
      recurse();
    }
    try {
      recurse();
    } catch (err) {
      ;
    }

    let recursionLimit = depth / 50;
    if (recursionLimit > 1000) {
      recursionLimit = 1000;
    }
    pyodide.runPython(
        `import sys; sys.setrecursionlimit(int(${recursionLimit}))`);
  };

  ////////////////////////////////////////////////////////////
  // Rearrange namespace for public API
  let PUBLIC_API = [
    'loadPackage',
    'loadedPackages',
    'pyimport',
    'repr',
    'runPython',
    'runPythonAsync',
    'version',
  ];

  function makePublicAPI(module, public_api) {
    var namespace = {_module : module};
    for (let name of public_api) {
      namespace[name] = module[name];
    }
    return namespace;
  }

  ////////////////////////////////////////////////////////////
  // Loading Pyodide
  let wasmURL = `${baseURL}hello.wasm`;
  let Module = {};
  window.Module = Module;

  Module.noImageDecoding = true;
  Module.noAudioDecoding = true;
  Module.noWasmDecoding = true;
  Module.preloadedWasm = {};
  Module.noInitialRun = true;
  let isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

  let wasm_promise = WebAssembly.compileStreaming(fetch(wasmURL));
  Module.instantiateWasm = (info, receiveInstance) => {
    wasm_promise.then(module => WebAssembly.instantiate(module, info))
        .then(instance => receiveInstance(instance));
    return {};
  };

  Module.locateFile = (path) => baseURL + path;
  Module.postRun = () => {
    Module._jl_initialize();
    input = "Base.load_InteractiveUtils()"
    ptr = Module._malloc(input.length + 1);
    Module.stringToUTF8(input, ptr, input.length + 1);
    Module._jl_eval_string(ptr);
    resolve();
  };

  Module.JlProxy = {
    isExtensible: function() { return false },
    isJlProxy: function (jsobj) {
      return jsobj['ptr'] !== undefined;
    },
    has: function(jsobj, key) {
      return false;
    },
    getPtr: function(jsobj) {
      return jsobj['ptr'];
    }
  }

  let data_script = document.createElement('script');
  data_script.src = `${baseURL}hello.js`;
  data_script.onload = (event) => {
    //let script = document.createElement('script');
    //script.src = `${baseURL}pyodide.asm.js`;
    //script.onload = () => {
      // The emscripten module needs to be at this location for the core
      // filesystem to install itself. Once that's complete, it will be replaced
      // by the call to `makePublicAPI` with a more limited public API.
      //window.pyodide.loadedPackages = new Array();
      //window.pyodide.loadPackage = loadPackage;
    //};
    //document.head.appendChild(script);
    window.jlodide = {
        runJulia: (input) => {
            ptr = Module._malloc(input.length + 1);
            Module.stringToUTF8(input, ptr, input.length + 1);
            result = Module._jl_eval_string(ptr);
            return new Proxy({ptr: result}, Module.JlProxy)
        }
    };
  };
  document.head.appendChild(data_script);

  ////////////////////////////////////////////////////////////
  // Iodide-specific functionality, that doesn't make sense
  // if not using with Iodide.
  if (window.iodide !== undefined) {
    // Add a custom output handler for Python objects
    window.iodide.addOutputHandler({
      shouldHandle : (val) => {
        return Module.JlProxy.isJlProxy(val);
      },

      render : (val) => {
        the_val = Module.JlProxy.getPtr(val);
        if (window.Plotly !== undefined) {
            input = 'function f(x); showable(MIME"application/vnd.plotly.v1+json"(), x); end; f'
            ptr = Module._malloc(input.length + 1);
            Module.stringToUTF8(input, ptr, input.length + 1);
            plotly_showable = Module._jl_eval_string(ptr);        
            
            the_val_showable = Module._jl_call1(plotly_showable, the_val)

            if (Module._jl_unbox_bool(the_val_showable) != 0) {
                // Get to_plotly
                input = "x->(buf = IOBuffer(); show(buf, MIME\"application/vnd.plotly.v1+json\"(), x); String(take!(buf)))"
                ptr = Module._malloc(input.length + 1);
                Module.stringToUTF8(input, ptr, input.length + 1);
                to_plotly = Module._jl_eval_string(ptr);

                str = Module._jl_call1(to_plotly, the_val)
                output = Pointer_stringify(Module._jl_string_ptr(str));
                let div = document.createElement('div');
                var figure = JSON.parse(output);
                Plotly.newPlot(div, figure.data, figure.layout)
                return div;
            }
        }
        // Get repr
        input = "x->(buf = IOBuffer(); show(buf, MIME\"text/plain\"(), x); String(take!(buf)))";
        ptr = Module._malloc(input.length + 1);
        Module.stringToUTF8(input, ptr, input.length + 1);
        repr = Module._jl_eval_string(ptr);

        // Get showable
        input = 'function f(x); showable(MIME"text/html"(), x); end; f'
        ptr = Module._malloc(input.length + 1);
        Module.stringToUTF8(input, ptr, input.length + 1);
        html_showable = Module._jl_eval_string(ptr);

        // Get to_html
        input = "x->(buf = IOBuffer(); show(buf, MIME\"text/html\"(), x); String(take!(buf)))"
        ptr = Module._malloc(input.length + 1);
        Module.stringToUTF8(input, ptr, input.length + 1);
        to_html = Module._jl_eval_string(ptr);

        the_val_showable = Module._jl_call1(html_showable, the_val)

        let div = document.createElement('div');
        if (Module._jl_unbox_bool(the_val_showable) != 0) {
            str = Module._jl_call1(to_html, the_val)
            output = Pointer_stringify(Module._jl_string_ptr(str));
            console.log(output)
            div.appendChild(new DOMParser()
                .parseFromString(output, 'text/html')
                .body);
        } else {
            str = Module._jl_call1(repr, the_val);
            output = Pointer_stringify(Module._jl_string_ptr(str));
            div.className = 'rendered_html';
            let pre = document.createElement('pre');
            pre.textContent = output;
            div.appendChild(pre);
        }
        return div;
      }
    });
  }
});
languagePluginLoader
