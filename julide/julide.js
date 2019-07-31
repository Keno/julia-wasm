/**
 * The main bootstrap script for loading pyodide.
 */

var languagePluginLoader = new Promise((resolve, reject) => {
  // This is filled in by the Makefile to be either a local file or the
  // deployed location. TODO: This should be done in a less hacky
  // way.
  var baseURL = self.languagePluginUrl;
  baseURL = baseURL.substr(0, baseURL.lastIndexOf('/')) + '/';

  function loadScript(url, onload, onerror) {
    if (self.document) { // browser
      const script = self.document.createElement('script');
      script.src = url;
      script.onload = (e) => { onload(); };
      script.onerror = (e) => { onerror(); };
      self.document.head.appendChild(script);
    } else if (self.importScripts) { // webworker
      try {
        self.importScripts(url);
        onload();
      } catch {
        onerror();
      }
    }
  }

  ////////////////////////////////////////////////////////////
  // Rearrange namespace for public API
  let PUBLIC_API = [
    'runJulia',
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
  let fileBaseURL = baseURL;
  let wasmBaseName = 'hello'
  if (baseURL.includes("keno.github.io")) {
     fileBaseURL = `${fileBaseURL}../../julia-wasm-build/`
     wasmBaseName = 'hello-no-bysyncify' // While we're working out performance issues
  }
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('variant')) {
     wasmBaseName = urlParams.get('variant');
  }


  let wasmURL = `${fileBaseURL}${wasmBaseName}.wasm`;
  let Module = {};
  self.Module = Module;

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

  Module.checkABI = function(ABI_number) {
    return true;
  }

  Module.locateFile = (path) => fileBaseURL + path;
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
  data_script_src = `${fileBaseURL}${wasmBaseName}.js`;
  loadScript(data_script_src, ()=> {
    self.jlodide = {
        runJulia: (input) => {
            ptr = Module._malloc(input.length + 1);
            Module.stringToUTF8(input, ptr, input.length + 1);
            result = Module._jl_eval_string(ptr);
            return new Proxy({ptr: result}, Module.JlProxy)
        }
    };
  }, () => {});

  ////////////////////////////////////////////////////////////
  // Iodide-specific functionality, that doesn't make sense
  // if not using with Iodide.
  try {
    if (self.iodide !== undefined) {
      // Add a custom output handler for Python objects
      self.iodide.addOutputRenderer({
        shouldRender : (val) => {
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
                  return div.outerHTML;
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
              output = UTF8ToString(Module._jl_string_ptr(str), 4096);
              console.log(output)
              div.appendChild(new DOMParser()
                  .parseFromString(output, 'text/html')
                  .body);
          } else {
              str = Module._jl_call1(repr, the_val);
              output = UTF8ToString(Module._jl_string_ptr(str), 4096);
              div.className = 'rendered_html';
              let pre = document.createElement('pre');
              pre.textContent = output;
              div.appendChild(pre);
          }
          return div.outerHTML;
        }
      });
    }
  } catch (e) {
    console.log(e);
  }

});
languagePluginLoader
