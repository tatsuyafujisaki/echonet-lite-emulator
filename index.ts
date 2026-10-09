/* ------------------------------------------------------------------
 * ELエミュレータ起動スクリプト
 *
 * システムのコントローラーとしての役割を担う
 * 以下のイベントを検知したら適切なモジュールへ中継する
 *  - REST API リクエスト受信
 *  - EL パケット受信
 *  - EL パケット送信
 *  - ユーザー設定情報更新
 * ---------------------------------------------------------------- */
import conf from './conf/config.ts';
import Console from './lib/Console.ts';
import Device from './lib/Device.ts';
import HttpApi from './lib/HttpApi.ts';
import HttpServer from './lib/HttpServer.ts';
import manufacturerTable from './lib/ManufacturerTable.ts';
import mra from './lib/Mra.ts';
import UserConf from './lib/UserConf.ts';
import pkg from './package.json' with {type: 'json'};

class Emulator {
  _api: any;
  _conf: any;
  _console: any;
  _device: any;
  _http: any;
  _uconf: any;
  /* ------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */
  constructor(options: any) {
    this._conf = conf;
    for (const k in options) {
      this._conf[k] = options[k];
    }

    this._device = null;
    this._api = null;
    this._console = new Console();
    this._http = new HttpServer(this._conf, this._console);
    this._uconf = new UserConf(this._conf);
  }

  // 初期化
  async init() {
    // ASCII アート出力
    this._console.printStartLogoAsciiArt();

    // バージョン出力
    this._console.printVersion(`v${pkg.version}`);

    // DeviceDescription のメタ情報を出力
    this._console.printDeviceDescriptionMetaData(mra.getMetaData());

    // ユーザー設定情報を取得
    this._console.printSysInitMsg('Loading the configurations...');
    this._uconf.init();
    const user_conf = this._uconf.get();

    // ユーザー設定情報を反映
    this._updatedUserConf(user_conf);

    // ユーザー設定情報の更新があったら反映
    this._uconf.on('updated', (user_conf: any) => {
      this._updatedUserConf(user_conf);
    });
    this._console.printSysInitRes('OK');

    // HTTP/WebSocket サーバー起動
    this._console.printSysInitMsg('Starting HTTP/WebSocket server...');
    await this._http.start();
    this._console.printSysInitRes('OK');
    this._console.printSysInfo('  - TCP port: ' + this._conf['dashboard_port']);
    // HTTP リクエストを受信したときの処理
    this._http.on('request', (req: any) => {
      this._httpApiRequested(req);
    });
    // デバイス起動
    this._device = await this._startDevice();

    // HTTP REST API エンドポイントの構築
    this._api = new HttpApi(
      this._conf,
      this._device,
      this._uconf,
      mra,
      manufacturerTable,
    );

    this._console.printSysInfo('This emulator is ready');
  }

  // デバイスを(再)起動
  async _startDevice() {
    let device = null;
    await this._stopDevice();

    // EL デバイスのインスタンスを生成
    device = new Device(this._conf, mra, manufacturerTable, this._console);

    // EL デバイスを初期化
    await device.init();

    // EL パケット受信イベントリスナーをセット
    device.on('received', (address: any, packet: any) => {
      this._http.wsSend({
        event: 'packetreceived',
        data: {
          direction: 'RX',
          address: address,
          packet: packet,
        },
      });
    });
    // EL パケット送信イベントリスナーをセット
    device.on('sent', (address: any, packet: any) => {
      this._http.wsSend({
        event: 'packetsent',
        data: {
          direction: 'TX',
          address: address,
          packet: packet,
        },
      });
    });
    // 以下のイベントはそのまま WebSocket で中継する
    // - epcupdated         : EPC 更新
    // - powerstatuschanged : デバイス電源状態変化
    // - discovered         : リモートデバイス発見
    // - disappeared        : リモートデバイスロスト
    // - remoteepcupdated   : リモートデバイス EPC 更新
    for (const event of [
      'epcupdated',
      'powerstatuschanged',
      'discovered',
      'disappeared',
      'remoteepcupdated',
    ]) {
      device.on(event, (data: any) => {
        this._http.wsSend({
          event: event,
          data: data,
        });
      });
    }

    // デバイス起動
    await device.start();
    return device;
  }

  // デバイスを停止
  async _stopDevice() {
    if (!this._device) {
      return;
    }
    await this._device.stop();
    this._device = null;
  }

  // REST リクエストを受けたら HttpApi (this._api) モジュールに中継
  async _httpApiRequested(data: any) {
    /*
     * 受信データのサンプル
     * data = {
     *   reqId: 12,
     *   method: "POST",
     *   path: "/api/device/power",
     *   params: {}
     * }
     */

    try {
      const rdata = await this._api.request(data);
      /*
       * レスポンスデータのサンプル
       * rdata = {
       *   "reqId": 1,
       *   "method": "GET",
       *   "path": "/api/system/lang",
       *   "params": {},
       *   "result": 0,
       *   "code": 200,
       *   "data": {
       *     "lang": "en"
       *   }
       * }
       */
      this._http.respond(rdata['code'], rdata);
    } catch (error: any) {
      data['result'] = 1;
      data['code'] = 500;
      data['message'] = error.message;
      this._http.respond(500, data);

      console.error(error);
    }
  }

  // ユーザー設定情報更新イベントを受けたときの処理
  _updatedUserConf(user_conf: any) {
    for (const k in user_conf) {
      this._conf[k] = user_conf[k];
    }
    if (this._api) {
      this._api.updateConf(this._conf);
    }
    if (this._device) {
      this._device.updateConf(this._conf);
    }
  }
}

/* ------------------------------------------------------------------
 * コマンドラインオプション
 * --enable-console-packet:
 *     パケット送受信出力を有効にする
 * --disable-clock
 *     EPC:0x97, 0x98 の日時を OS の時計と同期しないモード
 * ---------------------------------------------------------------- */
const options: Record<string, boolean> = {
  'console-packet': false,
  'clock-sync': true,
};
process.argv.forEach(opt => {
  if (!/^\-\-/.test(opt)) {
    return;
  }
  const k = opt.replace(/^\-\-(enable|disable)\-/, '');
  if (!(k in options)) {
    console.error('Unknown command line switch: ' + opt);
    process.exit();
  }
  if (/^\-\-enable/.test(opt)) {
    options[k] = true;
  } else if (/^\-\-disable/.test(opt)) {
    options[k] = false;
  }
});

// EL エミュレーター起動
const emulator = new Emulator(options);
await emulator.init();
