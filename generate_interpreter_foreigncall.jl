using Clang

INCLUDE_DIRS = [
    joinpath(@__DIR__, "julia", "src", "support") |> normpath
    joinpath(@__DIR__, "julia", "src", "flisp") |> normpath
    joinpath(@__DIR__, "julia", "build-wasm", "src") |> normpath
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include") |> normpath
]

LIBCLANG_INCLUDE = joinpath(@__DIR__, "julia", "src") |> normpath

JULIA_SRCS = [
    joinpath(LIBCLANG_INCLUDE, "anticodegen.c"),
    joinpath(LIBCLANG_INCLUDE, "sys.c"),
    joinpath(LIBCLANG_INCLUDE, "staticdata.c"),
    joinpath(LIBCLANG_INCLUDE, "jlapi.c"),
    joinpath(LIBCLANG_INCLUDE, "builtins.c"),
    joinpath(LIBCLANG_INCLUDE, "array.c"),
    joinpath(LIBCLANG_INCLUDE, "module.c"),
    joinpath(LIBCLANG_INCLUDE, "gc.c"),
    joinpath(LIBCLANG_INCLUDE, "signal-handling.c"),
    joinpath(LIBCLANG_INCLUDE, "rtutils.c"),
    joinpath(LIBCLANG_INCLUDE, "jl_antiuv.c"),
    joinpath(LIBCLANG_INCLUDE, "gf.c"),
    joinpath(LIBCLANG_INCLUDE, "task.c"),
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include", "pcre2.h"),
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include", "utf8proc.h")
]

EXTERNAL_SRCS = [
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include", "gmp.h"),
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include", "mpfr.h"),
    joinpath(@__DIR__, "julia", "build-wasm", "usr", "include", "dSFMT.h")
]

const libc_symbols = ["memchr", "strlen", "memcpy", "memmove", "memset", "getenv", "setenv", "srand", "memcmp"]

unsugar(t::CLTypedef) = unsugar(underlying_type(typedecl(t)))
unsugar(t::CLElaborated) = unsugar(get_named_type(t))
unsugar(t) = t

const CLSugared = Union{CLTypedef, CLElaborated}

is_ptr(t::CLPointer) = true
is_ptr(t::CLSugared) = is_ptr(unsugar(t))
is_ptr(t) = false
is_any(t::CLPointer) = spelling(pointee_type(t)) in ("jl_value_t", "jl_module_t", "jl_array_t", "jl_function_t", "jl_task_t", "jl_weakref_t", "jl_sym_t", "jl_methtable_t", "jl_tupletype_t", "jl_datatype_t", "jl_method_t", "jl_svec_t", "jl_code_info_t", "jl_method_instance_t", "jl_expr_t", "jl_task_t", "jl_typemap_entry_t", "jl_typemap_level_t", "jl_ssavalue_t", "jl_tvar_t", "jl_unionall_t", "jl_typename_t", "jl_uniontype_t")
is_any(t) = false

deptr(t::CLPointer) = pointee_type(t)
deptr(t) = t

is_enum(t::CLEnum) = true
is_enum(t::CLTypedef) = is_enum(underlying_type(typedecl(t)))
is_enum(t::CLElaborated) = is_enum(get_named_type(t))
is_enum(t) = false

function declare_type(decls, t)
    t = deptr(t)
    if isa(t, CLElaborated)
        t = get_named_type(t)
    end
    if isa(t, CLFunctionProto)
        declare_type(decls, result_type(t))
        for i = 0:(argnum(t)-1)
            declare_type(decls, argtype(t, i))
        end
    end
    if isa(t, CLTypedef)
        startswith(typedef_name(t), "jl_") && return
        (typedef_name(t) in blacklist_decl) && return
        if !(typedef_name(t) in declared_types)
            declare_type(decls, unsugar(t))
            tt = unsugar(t)
            if isa(deptr(tt), CLFunctionProto)
                print(decls, "typedef ", result_type(tt), "(*", typedef_name(t),")(")
                for i = 0:(argnum(tt)-1)
                    print(decls, spelling(argtype(tt, i)))
                    i == argnum(tt)-1 || print(decls, ",")
                end
                println(");")
            elseif isa(deptr(tt), CLUnexposed)
                println(decls, "typedef void *", typedef_name(t), ";")
            elseif isa(tt, CLRecord) && !startswith(spelling(tt), "struct")
                println(decls, "typedef struct $(typedef_name(t)) $(typedef_name(t));")
            elseif isa(tt, CLEnum)
                println(decls, "typedef int $(typedef_name(t));")
            elseif isa(tt, CLConstantArray)
                declare_type(decls, element_type(tt))
                println(decls, "typedef void *$(typedef_name(t));")
            else
                println(decls, "typedef $(spelling(unsugar(t))) $(typedef_name(t));")
                push!(declared_types, typedef_name(t))
            end
        end
    elseif isa(t, CLRecord)
        if !(spelling(t) in declared_types)
            if !startswith(spelling(t), "struct")
                println(decls, "struct ", spelling(t), ";")
                push!(declared_types, spelling(t))
            else
                println(decls, spelling(t), ";")
                push!(declared_types, spelling(t))
            end
        end
    elseif isa(t, CLEnum)
        # Do nothing, we map this to int
    else
    end
end
declare_types(decls, types) = map(t->declare_type(decls, t), types)

const blacklist_decl = Set{String}(("jl_gc_alloc", "uint64_t", "ios_t", "int64_t", "bufmode_t", "JL_IMAGE_SEARCH", "uint_t", "pcre2_callout_enumerate_8", "pcre2_callout_enumerate_16", "pcre2_callout_enumerate_32", "pcre2_set_callout_8", "pcre2_set_callout_16", "pcre2_set_callout_32",
"htable_t"))

function generate_case(decls, out, fdecl)
    all_types = [return_type(fdecl), (argtype(type(fdecl), i) for i = 0:(length(function_args(fdecl))-1))...]
    declare_types(decls, all_types)
    fname = spelling(fdecl)
    fargs = function_args(fdecl)
    if !(fname in blacklist_decl)
        if length(fargs) == 0
            print(decls, "extern ", spelling(return_type(fdecl)), " ", spelling(fdecl), "(void);\n")
        else
            print(decls, "extern ", spelling(return_type(fdecl)), " ", name(fdecl), ";\n")
        end
    end
    println(out, "else if (strcmp(target, \"", spelling(fdecl), "\") == 0) {")
    ret_type = return_type(fdecl)
    rk = clang2julia(unsugar(ret_type))
    print(out, "\t")
    if rk != :Cvoid
        print(out, spelling(ret_type), " result = ")
    end
    callout = IOBuffer()
    print(callout, spelling(fdecl), "(")
    println(stderr, spelling(fdecl))
    if length(fargs) == 0
        print(callout, ");\n")
    else
        print(callout, "\n")
        for (i, arg) in enumerate(fargs)
            at = argtype(type(fdecl), i-1)
            tk = clang2julia(unsugar(at))
            arg = "eval_value(args[$(4+i)], s)"
            if is_any(at)
                ub = arg
            elseif tk == :Csize_t || tk == :UInt32 || tk == :Culong
                ub = "jl_unbox_uint32($arg)";
            elseif tk == :UInt64
                ub = "jl_unbox_uint64($arg)";
            elseif tk == :Int64
                ub = "jl_unbox_int64($arg)";
            elseif tk == :Cint || tk == :Int32 || is_enum(at)
                ub = "jl_unbox_int32($arg)";
            elseif tk == :UInt8 || tk == :Cuchar
                ub = "jl_unbox_uint8($arg)";
            elseif tk == :Int8
                ub = "jl_unbox_int8($arg)";
            elseif tk == :Int16
                ub = "jl_unbox_int16($arg)";
            elseif tk == :UInt16
                ub = "jl_unbox_uint16($arg)";
            elseif tk == :Clong
                ub = "jl_unbox_long($arg)";
            elseif tk == :Cfloat || tk == :Float32
                ub = "jl_unbox_float32($arg)";
            elseif tk == :Cdouble || tk == :Float64
                ub = "jl_unbox_float64($arg)";
            elseif isa(tk, Expr) || tk == :Cstring || tk == :jl_ptls_t || is_ptr(at)
                ub = "jl_unbox_voidpointer($arg)";
            elseif tk == :jl_uuid_t
                print(out, """
                jl_uuid_t arg$i;
                \tmemcpy(&arg$i, jl_data_ptr($arg), sizeof(jl_uuid_t));
                \t""")
                ub = "arg$i"
            else
                error("Unmapped argument type $tk in `$(spelling(fdecl))`")
            end
            if isa(at, CLIncompleteArray)
                cast = string(spelling(element_type(at)), " *")
            else
                cast = spelling(at)
            end
            print(callout, "\t\t\t(", cast, ") ", ub)
            i == length(fargs) || print(callout, ",")
            print(callout, "\n")
        end
        println(callout, "\t\t);")
    end
    print(out, String(take!(callout)))
    if is_any(ret_type)
        println(out, "\treturn result;")
    else
        if rk == :Csize_t || rk == :UInt32 || rk == :Culong
            println(out, "\treturn jl_box_uint32(result);")
        elseif rk == :Cint || rk == :Int32 || rk == :ssize_t || is_enum(ret_type)
            println(out, "\treturn jl_box_int32(result);")
        elseif rk == :Clong
            println(out, "\treturn jl_box_long(result);")
        elseif rk == :Int8 || rk == :Bool
            println(out, "\treturn jl_box_int8(result);")
        elseif rk == :UInt8 || rk == :Cuchar
            println(out, """
            \tjl_datatype_t *rt = (jl_datatype_t*)eval_value(args[1], s);
            \treturn (rt == jl_bool_type) ? jl_box_bool(result) : jl_box_uint8(result);
            """)
        elseif rk == :Int16
            println(out, "\treturn jl_box_int16(result);")
        elseif rk == :UInt16
            println(out, "\treturn jl_box_uint16(result);")
        elseif rk == :Int64
            println(out, "\treturn jl_box_int64(result);")
        elseif rk == :UInt64
            println(out, "\treturn jl_box_int64(result);")
        elseif rk == :Cvoid
            println(out, "\treturn jl_nothing;")
        elseif rk == :Cstring || isa(rk, Expr) || rk == :jl_ptls_t || is_ptr(ret_type)
            # Return this according to the pointer type chosen on the julia side
            println(out, """
            \tjl_ptls_t ptls = jl_get_ptls_states();
            \tjl_value_t *v = jl_gc_alloc(ptls, sizeof(void*), eval_value(args[1], s));
            \t*(void**)jl_data_ptr(v) = (void*)result;
            \treturn v;
            """)
        elseif rk == :jl_uuid_t || rk == :jl_gc_num_t || rk == :jl_nullable_float64_t || rk == :jl_nullable_float32_t
            # Return this according to the pointer type chosen on the julia side
            println(out, """
            \tjl_ptls_t ptls = jl_get_ptls_states();
            \tjl_value_t *v = jl_gc_alloc(ptls, sizeof($rk), eval_value(args[1], s));
            \tmemcpy(jl_data_ptr(v), &result, sizeof($rk));
            \treturn v;
            """)
        elseif rk == :Cfloat || rk == :Float32
            println(out, "\treturn jl_box_float32(result);")
        elseif rk == :Cdouble || rk == :Float64
            println(out, "\treturn jl_box_float64(result);")
        else
            error("Unmapped return type $(rk) in `$(spelling(fdecl))`")
        end
    end
    print(out, "} ")
end

fbuf = IOBuffer()
obuf = IOBuffer()

# create a work context
ctx = DefaultContext()

jl_tus = parse_headers!(ctx, JULIA_SRCS,
    args=["-I", joinpath(LIBCLANG_INCLUDE, ".."), "-DJL_DISABLE_LIBUNWIND", "-DJL_DISABLE_LIBUV", "-D__wasm__", "-D_GNU_SOURCE", "-DPCRE2_EXP_DECL=__attribute__ ((visibility(\"default\")))", "-DPCRE2_CODE_UNIT_WIDTH=8"],
    includes=vcat(LIBCLANG_INCLUDE, INCLUDE_DIRS, CLANG_INCLUDE),
)

ext_tus = parse_headers!(ctx, EXTERNAL_SRCS,
    args=["-I", joinpath(LIBCLANG_INCLUDE, ".."), "-DJL_DISABLE_LIBUNWIND", "-DJL_DISABLE_LIBUV", "-D__wasm__", "-D_GNU_SOURCE", "-DPCRE2_CODE_UNIT_WIDTH=8"],
    includes=vcat(LIBCLANG_INCLUDE, INCLUDE_DIRS, CLANG_INCLUDE),
)


fnames = Set{String}()
declared_types = Set{String}()

function process_tu(fbuf, obuf, tu, only_exported = true)
    for f in children(getcursor(tu))
        isa(f, CLFunctionDecl) || continue
        clds = children(f)
        fname = spelling(f)
        if only_exported
            if !(fname in libc_symbols)
                idx = findfirst(x->isa(x, CLVisibilityAttr), clds)
                idx === nothing && continue
                spelling(clds[idx]) != "default" && continue
            end
        else
            # Exclude anything in system headers
            loc = Clang.location(f)
            Clang.clang_Location_isInSystemHeader(loc) != 0 && continue
        end
        (fname in blacklist_decl) && continue
        if fname in fnames
            continue
        end
        isa(type(f), CLFunctionProto) || continue
        if any(0:length(function_args(f))-1) do i
                at = argtype(type(f), i)
                return spelling(at) == "va_list"
            end
                continue
        end
        generate_case(fbuf, obuf, f)
        push!(fnames, fname)
    end
end

foreach(x->process_tu(fbuf, obuf, x, true), jl_tus)
foreach(x->process_tu(fbuf, obuf, x, false), ext_tus)

print("""
// This file was auto-generated. Do not edit.
#include "julia.h"
#include "julia_internal.h"
#include "julia_gcext.h"
#include "gc.h"

$(String(take!(fbuf)))

struct interpreter_state;
typedef struct interpreter_state interpreter_state;
extern jl_value_t *eval_value(jl_value_t *e, interpreter_state *s);
jl_value_t *eval_foreigncall(jl_sym_t *fname, jl_sym_t *libname, interpreter_state *s, jl_value_t **args, size_t nargs)
{
const char *target = jl_symbol_name(fname);
// jl_value_ptr is special
if (strcmp(target, "jl_value_ptr") == 0) {
    if (eval_value(args[1], s) == (jl_value_t*)jl_any_type) {
        return (jl_value_t*)jl_unbox_voidpointer(eval_value(args[5], s));
    } else {
        jl_ptls_t ptls = jl_get_ptls_states();
        jl_value_t *ret = (void*)eval_value(args[5], s);
        jl_value_t *v = jl_gc_alloc(ptls, sizeof(void*), eval_value(args[1], s));
        *(void**)jl_data_ptr(v) = ret;
        return v;
    }
} else if (strcmp(target, "jl_get_ptls_states") == 0) {
    return jl_box_voidpointer((void*)jl_get_ptls_states());
} else if (strcmp(target, "jl_symbol_name") == 0) {
    jl_ptls_t ptls = jl_get_ptls_states();
    const char *name = jl_symbol_name(eval_value(args[5], s));
    jl_value_t *v = jl_gc_alloc(ptls, sizeof(void*), eval_value(args[1], s));
    *(void**)jl_data_ptr(v) = name;
    return v;
} $(String(take!(obuf)))

return NULL;
} """)
