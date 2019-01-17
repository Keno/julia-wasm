#!/bin/bash
export DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR/julia/build-wasm
make -C src && cp ../build-native/usr/lib/julia/sys.ji . && emcc -DJL_DISABLE_LIBUV -Isrc -I../src -I../src/support -Lusr/lib -ljulia -lLLVMSupport -lpcre2-8 -lgmp -lmpfr ../ui/wasm-support.c --preload-file base/boot.jl --preload-file sys.ji --no-heap-copy --source-map-base http://localhost:8888/ -g4 -s -s WASM=1 -s ASSERTIONS=2 -s ALLOW_MEMORY_GROWTH=1 -s "EXPORTED_FUNCTIONS=['_main','_jl_toplevel_eval_in','_jl_initialize', '_jl_eval_and_print', '_jl_eval_string',
'_mpfr_set_emin', '_jl_call1', '_jl_string_ptr','_jl_unbox_bool']" -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s RESERVED_FUNCTION_POINTERS=20 -s "EXTRA_EXPORTED_RUNTIME_METHODS=['stringToUTF8']" --emrun -o $DIR/website/hello.js -fcolor-diagnostics
