/* ------------------------------------------------------------------
 * ダッシュボード Web アプリ, REST API 用の Web サーバーと WebSocket サーバー
 * ---------------------------------------------------------------- */
import {EventEmitter, once} from 'node:events';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import {WebSocketServer, WebSocket} from 'ws';

/* ------------------------------------------------------------------
 * イベント:
 * - request(data) : REST API リクエストを受信した
 * ---------------------------------------------------------------- */
class HttpServer extends EventEmitter {
  _app: any;
  _conf: any;
  _console: any;
  _http_server: any;
  _req_id: any;
  _req_pool: any;
  _wss: any;
  constructor(conf: any, oconsole: any) {
    super();
    this._conf = conf;
    this._console = oconsole;

    this._req_id = 0;
    this._req_pool = {};

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({extended: true}));
    this._app = app;

    this._http_server = null;
    this._wss = null;
  }

  async start(): Promise<void> {
    const server = http.createServer(this._app);
    this._http_server = server;
    this._wss = new WebSocketServer({server});

    this._defineRouting();
    this._startWatchingReqPool();

    server.listen(this._conf['dashboard_port']);
    await once(server, 'listening');
  }

  _startWatchingReqPool() {
    let sec = this._conf['dashboard_timeout_sec'];
    if (!sec || typeof sec !== 'number') {
      sec = 30;
    }
    setInterval(() => {
      for (const req_id in this._req_pool) {
        const req = this._req_pool[req_id];
        if (Date.now() - req['time'] > sec * 1000) {
          const data = req['data'];
          data['result'] = 1001;
          data['message'] = 'Response Timeout.';
          this.respond(504, data);
          delete this._req_pool[req_id];
        }
      }
    }, 1000);
  }

  _defineRouting() {
    // CORS headers
    this._app.use((_req: any, res: any, next: any) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Access-Key, Content-Type, Accept',
      );
      res.header(
        'Access-Control-Allow-Methods',
        'GET, PUT, POST, DELETE, OPTIONS',
      );
      next();
    });
    // For CORS preflight request
    this._app.use((req: any, res: any, next: any) => {
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    this._app.use(express.urlencoded({extended: false}));
    this._app.use(express.json());

    this._app.use((req: any, res: any, next: any) => {
      if (/^\/api\//.test(req.path)) {
        // リクエストID生成
        const req_id = this._assignReqId();
        const parsedUrl = new URL(
          req.url,
          `http://${req.headers.host ?? 'localhost'}`,
        );
        let params = req.query;
        if (/^(PUT|POST)$/.test(req.method)) {
          params = req.body;
        }
        const data = {
          reqId: req_id,
          method: req.method,
          path: parsedUrl.pathname,
          params: params,
        };
        this._req_pool[req_id] = {
          req: req,
          res: res,
          data: data,
          time: Date.now(),
        };
        this.emit('request', data);
      } else {
        next();
      }
    });

    // 静的ファイル格納場所を定義
    this._app.use(express.static(path.resolve(import.meta.dirname, '../html')));

    // body-parser などの例外をキャッチ
    //   基本的には POST/PUT された JSON の構文エラー
    this._app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(400);
      res.header('Content-Type', 'application/json; charset=utf-8');
      res.send({
        result: 1,
        code: 400,
        message: error.message,
        errs: {},
      });
    });
  }

  _assignReqId() {
    return ++this._req_id;
  }

  respond(http_code: any, data: any) {
    if (!('reqId' in data)) {
      return;
    }

    const req_id = data['reqId'];
    if (!(req_id in this._req_pool)) {
      return;
    }
    delete data['reqId'];
    const res = this._req_pool[req_id]['res'];
    res.status(http_code);
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.send(data);

    // const req = this._req_pool[req_id]['req'];
    delete this._req_pool[req_id];
  }

  wsSend(o: any) {
    this._wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(o), (error: any) => {
          if (error) {
            this._console.printError(
              'Failed to send a message on the WebSocket channel.',
              error,
            );
          }
        });
      }
    });
  }
}

export default HttpServer;
