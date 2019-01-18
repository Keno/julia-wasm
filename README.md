# Julia on WASM - Setup instructions

This repo contains various experiments for setting up julia on wasm.
It's intended for collaboration and issue tracking before things are
working sufficiently to switch to the appropriate upstream repo:
There's two scripts in this repo:
 - `build_julia_wasm.sh` which will setup all the directories and build two copies
   of julia (one natively for cross compiling the system image, one for wasm)
 - `rebuild_js.sh` which will rebuild just the wasm parts and dump it into the website/
   directory which is a hacked up copy of https://github.com/vtjnash/JuliaWebRepl.jl

# Try it out

There's two ways to try out the current state of the wasm port without building anything yourself.
1. An instance of the Web REPL hosted at https://keno.github.io/julia-wasm/website/repl.htm
2. Using the iodide IDE plugin (see https://extremely-alpha.iodide.io/notebooks/225/ to get started).

Both use a pre-built version that it regularly pushed to this repo. However, to save space it may
be a few days out of date. Please note that this is an extremely early alpha and many things are likely
(and known) to be broken.

# To get started
First install the emscripten SDK, then
```
# Do this every time you start a session
source ~/emsdk/emsdk_env.sh
# Do this once
./build_julia_wasm.sh
# Do this after you change something on the wasm side
./rebuild_js.sh
# Use this to start a web server to serve the website
# Restart it when it crashes
emrun --no_browser --port 8888 website/repl.htm &
```
At the moment `Firefox Developer Edition` seems to have the most complete
wasm support and seems to be the fastest, so I'd recommend trying that.
After starting the server above, just navigate to `localhost:8888/repl.htm`
