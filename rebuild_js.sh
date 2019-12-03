#!/bin/bash
export DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

export WASM_NAME=hello.js
export BLACKLIST='["with_tvar","intersect","intersect_sub_datatype", "finish_unionall", "jl_gc_big_alloc", "jl_iintrinsic_1", "jl_iintrinsic_2", "jl_instantiate_type_in_env", "inst_ftypes", "jl_", "jl_gc_alloc", "jl_gc_pool_alloc", "jl_gc_collect", "__vfprintf_internal", "_applyn", "gc", "fl_load_system_image", "eval_abstracttype", "eval_primitivetype", "eval_structtype", "equiv_type", "_compile_all_tvar_union", "run_finalizer", "qsort", "fwrite"]'

mkdir -p $DIR/nsysimg

pushd $DIR/julia/build-native
make julia-sysimg-bc
cp usr/lib/julia/sys.bc $DIR/nsysimg/
popd

pushd $DIR/nsysimg
llvm-ar -x sys.bc
../llvm-build/bin/opt -mtriple=wasm32-unknown-unknown-wasm data.bc -o data.wasm.bc
../llvm-build/bin/opt -mtriple=wasm32-unknown-unknown-wasm text.bc -o text.wasm.bc
popd

pushd $DIR/julia/build-wasm
make -C src debug -j

emcc -DJL_DISABLE_LIBUV -Isrc -I../src -I../src/support -Lusr/lib -ljulia-debug \
-lLLVMSupport -lpcre2-8 -lgmp -lmpfr -ldSFMT $DIR/nsysimg/text.wasm.bc $DIR/nsysimg/data.wasm.bc ../ui/wasm-support.c \
--no-heap-copy \
--source-map-base http://localhost:8888/ -s WASM=1 -s ASSERTIONS=2 \
-s ALLOW_MEMORY_GROWTH=1 -s "EXPORTED_FUNCTIONS=['_main','_jl_toplevel_eval_in','_jl_initialize', '_jl_eval_and_print', '_jl_eval_string','_mpfr_set_emin','_jl_call1', '_jl_string_ptr','_jl_unbox_bool', '_start_task', '_jl_get_current_task', '_task_ctx_ptr', '_jl_get_root_task', '_jl_task_wait', '_jl_schedule_task', '_jl_get_main_module', '_jl_get_global', '_jl_symbol', '_jl_get_ptls_states', '_jl_gc_alloc']" \
-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s RESERVED_FUNCTION_POINTERS=20 \
-s "EXTRA_EXPORTED_RUNTIME_METHODS=['stringToUTF8']" -s WASM_OBJECT_FILES=1 \
-s ASYNCIFY_IMPORTS='["emscripten_sleep","jl_set_fiber","jl_swap_fiber","jl_start_fiber"]' \
--pre-js ../src/jsvm-emscripten/boxed.js --js-library ../src/jsvm-emscripten/task.js --js-library ../src/jsvm-emscripten/jscall.js --emrun \
-s ASYNCIFY_BLACKLIST="$BLACKLIST" -fcolor-diagnostics -O3  -o $DIR/website/$WASM_NAME -s TOTAL_MEMORY=536870912 -g2 -s SAFE_HEAP=1 -s ASYNCIFY=1
