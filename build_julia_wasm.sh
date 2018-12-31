#!/bin/bash
export DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
git clone https://github.com/JuliaLang/julia julia
cd julia
git checkout kf/wasm3
make O=build-native configure
make O=build-wasm configure
cat > build-native/Make.user <<EOF
DISABLE_LIBUV := 1
JULIA_THREADS := 0
ARCH=i686
EOF
cat > build-wasm/Make.user <<EOF
override CC=emcc
override CXX=emcc
JULIACODEGEN=none
CFLAGS=--source-map-base http://localhost:8888/ -g4 -s WASM=1 -D__wasm__
override OS=emscripten
override DISABLE_LIBUNWIND=1
override JULIA_THREADS=0
override USE_SYSTEM_BLAS=1
override USE_SYSTEM_LAPACK=1
override USE_SYSTEM_LIBM=1
override USE_SYSTEM_DSFMT=1
override USE_SYSTEM_SUITESPARSE=1
override LLVM_CONFIG_HOST=${DIR}/julia/build-native/usr/tools/llvm-config
override USE_CROSS_FLISP=1
override DISABLE_LIBUV=1
override JULIA_THREADS=0
override XC_HOST=wasm32-unknown-emscripten
USE_BINARYBUILDER_LLVM=1
BINARYBUILDER_TRIPLET=wasm32-unknown-emscripten
override LLVM_BB_URL_BASE := https://github.com/tshort/LLVMBuilder/releases/download
override LLVM_BB_REL = 0-wasm
EOF
(cd build-native && make -j20)
(cd build-wasm && make -C deps BUILDING_HOST_TOOLS=1 install-libuv install-utf8proc)
(cd build-wasm && make -j20 julia-ui-release)
