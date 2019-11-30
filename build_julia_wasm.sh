#!/bin/bash
export DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

export PATH="${DIR}/llvm-build/bin:${PATH}"
source $DIR/emsdk/emsdk_env.sh

pushd julia

(cd build-wasm && make -C deps BUILDING_HOST_TOOLS=1 install-libuv install-utf8proc)
(cd build-wasm && make -C deps -j)
(cd build-native && make -j)
(cd build-wasm && make -j julia-ui-release)
