/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 *
 * `triton instance reboot ...`
 */

var assert = require('assert-plus');
var vasync = require('vasync');
var mod_fs = require('fs');
var mod_tty = require('tty');

var common = require('../common');
var errors = require('../errors');

function do_exec(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new errors.UsageError('missing INST arg(s)'));
        return;
    } else if (args.length < 2) {
        cb(new errors.UsageError('missing CMD arg(s)'));
        return;
    }

    var id = args[0];
    var argv = args.slice(1);

    var tritonapi = this.top.tritonapi;
    common.cliSetupTritonApi({cli: this.top}, function onSetup(setupErr) {
        if (setupErr) {
            cb(setupErr);
            return;
        }

        tritonapi.getInstance({
            id: id,
            fields: ['id']
        }, function (lookupErr, inst) {
            if (lookupErr) {
                cb(lookupErr);
                return;
            }

            tritonapi.cloudapi.machineExecInteractive(inst.id, argv,
                function (err, ws) {

                if (err) {
                    cb(err);
                    return;
                }
                openTTY(function (err2, rfd, wfd, rtty, wtty) {
                    if (err2) {
                        cb(err);
                        return;
                    }

                    terminal(ws, rtty, wtty, function cleanup() {
                        rtty.setRawMode(false);
                        rtty.pause();
                        rtty.removeAllListeners('data');
                        if (wfd !== undefined && wfd !== rfd) {
                            wtty.end();
                            mod_fs.closeSync(wfd);
                        }
                        if (rfd !== undefined) {
                            rtty.end();
                            mod_fs.closeSync(rfd);
                        }
                    });
                });
            });
        });
    });
}

function terminal(ws, rtty, wtty, cleanup) {
    var buf = '';
    var ecode = 0;
    ws.on('binary', function (msg) {
        buf += msg.toString('utf-8');
        var parts = buf.split('\n');
        while (parts.length > 1) {
            var line = parts.shift();
            var evt = JSON.parse(line);
            switch (evt.type) {
            case 'tty':
                wtty.write(evt.data);
                break;
            case 'stdout':
                process.stdout.write(evt.data);
                break;
            case 'stderr':
                process.stderr.write(evt.data);
                break;
            case 'end':
                ws.end();
                ecode = evt.data.code;
                break;
            }
        }
        buf = parts[0];
    });
    ws.on('end', function () {
        cleanup();
        process.exit(ecode);
    });
    rtty.on('data', function (chunk) {
        var msg = JSON.stringify({
            type: 'stdin',
            data: chunk.toString('utf-8')
        }) + '\n';
        ws.send(new Buffer(msg, 'utf-8'));
    });
    rtty.resume();
    rtty.setRawMode(true);
    rtty.resume();
}

function openTTY(cb) {
    mod_fs.open('/dev/tty', 'r+', function (err, rttyfd) {
        if ((err && (err.code === 'ENOENT' || err.code === 'EACCES')) ||
            (process.version.match(/^v0[.][0-8][.]/))) {
            cb(null, undefined, undefined, process.stdin,
                process.stdout);
            return;
        }
        var rtty = new mod_tty.ReadStream(rttyfd);
        mod_fs.open('/dev/tty', 'w+', function (err3, wttyfd) {
            var wtty = new mod_tty.WriteStream(wttyfd);
            if (err3) {
                cb(err3);
                return;
            }
            cb(null, rttyfd, wttyfd, rtty, wtty);
        });
    });
}


do_exec.synopses = ['{{name}} exec [OPTIONS] INST CMD'];
do_exec.help = [
    'Execute a command on an instance.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Where "INST" is an instance name, id, or short id.'
].join('\n');
do_exec.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_exec.completionArgtypes = ['tritoninstance'];



module.exports = do_exec;
