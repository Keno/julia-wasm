/*
    Network Protol

    This needs to match the message
    types listed in ui/webserver/message_types.h.
*/

// input messages (to julia)
var MSG_INPUT_NULL = 0
var MSG_INPUT_START = 1
var MSG_INPUT_POLL = 2
var MSG_INPUT_EVAL = 3
var MSG_INPUT_REPLAY_HISTORY = 4
var MSG_INPUT_GET_USER = 5

// output messages (to the browser)
var MSG_OUTPUT_NULL = 0
var MSG_OUTPUT_WELCOME = 1
var MSG_OUTPUT_READY = 2
var MSG_OUTPUT_MESSAGE = 3
var MSG_OUTPUT_OTHER = 4
var MSG_OUTPUT_EVAL_INPUT = 5
var MSG_OUTPUT_FATAL_ERROR = 6
var MSG_OUTPUT_EVAL_INCOMPLETE = 7
var MSG_OUTPUT_EVAL_RESULT = 8
var MSG_OUTPUT_EVAL_ERROR = 9
var MSG_OUTPUT_PLOT = 10
var MSG_OUTPUT_GET_USER = 11
var MSG_OUTPUT_HTML = 12

/*
    REPL implementation.
*/

// the user name
var user_name = "julia"

// the user id
var user_id = ""

// indent string
var indent_str = "    "

// how long we delay in ms before polling the server again
var poll_interval = 300

// how long before we drop a request and try anew

// keep track of whether we are waiting for a message (and don't send more if we are)
var waiting_for_response = false

// a queue of messages to be sent to the server
var outbox_queue = []

// a queue of messages from the server to be processed
var inbox_queue = []

// keep track of whether new terminal data will appear on a new line
var new_line = true

// keep track of whether we have received a fatal message
var dead = false

// keep track of terminal history
var input_history = []
var input_history_current = [""]
var input_history_id = 0
var input_history_size = 1000

// an array of message handlers
var message_handlers = []

message_handlers[MSG_OUTPUT_NULL] = function (msg) {} // do nothing

message_handlers[MSG_OUTPUT_READY] = function (msg) {
    // // remove the initializing message
    // $("#terminal").html("");
    // // enable input
    // $("#prompt").show();
    // $("#terminal-input").removeAttr("disabled");
    // $("#terminal-input").show();
    // $("#terminal-input").focus();
    // // reset the size of the input box
    // set_input_width();
}

message_handlers[MSG_OUTPUT_MESSAGE] = function (msg) {
    // print the message
    // add_to_terminal("<span class=\"color-scheme-message\">"+escape_html(msg[0])+"</span><br /><br />");
}

message_handlers[MSG_OUTPUT_OTHER] = function (msg) {
    // just print the output
    // add_to_terminal(escape_html(msg[0]));
}

message_handlers[MSG_OUTPUT_FATAL_ERROR] = function (msg) {
    // print the error message
    // add_to_terminal("<span class=\"color-scheme-error\">"+escape_html(msg[0])+"</span><br /><br />");

    // stop processing new messages
    dead = true
    inbox_queue = []
    outbox_queue = []
}

message_handlers[MSG_OUTPUT_EVAL_INCOMPLETE] = function (msg) {
    // // re-enable the input field
    // $("#terminal-input").removeAttr("disabled");
    // // focus the input field
    // $("#terminal-input").focus();
    // // add a newline for the user
    // $("#terminal-input").newline_at_caret();
}

message_handlers[MSG_OUTPUT_EVAL_ERROR] = function (msg) {
    // // print the error message
    // add_to_terminal("<span class=\"color-scheme-error\">"+escape_html(msg[1])+"</span><br /><br />");
    // // check if this was from us
    // if (msg[0] == user_id) {
    //     enable_prompt();
    // }
}

message_handlers[MSG_OUTPUT_EVAL_RESULT] = function (msg) {
    // // print the result
    // if ($.trim(msg[1]) == "")
    //     add_to_terminal("<br />");
    // else
    //     add_to_terminal(escape_html(msg[1])+"<br /><br />");
    // if (msg[0] == user_id) {
    //     enable_prompt();
    // }
}

message_handlers[MSG_OUTPUT_HTML] = function (msg) {
    // add_html_to_terminal(msg[1]);
    // if (msg[0] == user_id) {
    //     enable_prompt();
    // }
}

function process_input(input) {
    ptr = Module._malloc(input.length + 1)
    Module.stringToUTF8(input, ptr, input.length + 1)
    Module._jl_eval_and_print(ptr)
}

var Module = {
    preRun: [],
    postRun: [],
    noInitialRun: true,
    print: (function () {
        return function (text) {
            console.info(text)
        }
    })(),
    printErr: function (text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(" ")
        if (0) {
            // XXX disabled for safety typeof dump == 'function') {
            // dump(text + "\n") // fast, straight to the real console
            console.error(text)
        } else {
            console.error(text)
        }
    },
    setStatus: function (text) {
        console.info("Status: ", text)
    },
    totalDependencies: 0,
    monitorRunDependencies: function (left) {
        this.totalDependencies = Math.max(this.totalDependencies, left)
        Module.setStatus(left ? "Preparing... (" + (this.totalDependencies - left) + "/" + this.totalDependencies + ")" : "All downloads complete.")
    },
    postRun: [
        function () {
            Module._jl_initialize()
            input = "Base.load_InteractiveUtils()"
            ptr = Module._malloc(input.length + 1)
            Module.stringToUTF8(input, ptr, input.length + 1)
            Module._jl_eval_string(ptr)
            if (Module.initialize_jscall_runtime !== undefined) {
                Module.initialize_jscall_runtime()
            }
        },
    ],
}
Module.setStatus("Downloading...")
window.onerror = function (event) {
    // TODO: do not warn on ok events like simulating an infinite loop or exitStatus
    Module.setStatus("Exception thrown, see JavaScript console")
    Module.setStatus = function (text) {
        if (text) Module.printErr("[post-exception status] " + text)
    }
}

var path = "https://keno.github.io/julia-wasm-build/hello-no-bysyncify.js"
Module["locateFile"] = function (file, prefix) {
    return path.substring(0, path.lastIndexOf("/")) + "/" + file
}
