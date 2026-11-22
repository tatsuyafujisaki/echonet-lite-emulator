/* ------------------------------------------------------------------
 * エミュレートする EL デバイスを表すモジュール
 *
 * - EL パケットの送受信はこのモジュールがハンドリングする
 * - 必要に応じてコントローラーとなる index.js にイベントハンドラを通して伝達する
 * ---------------------------------------------------------------- */
import dgram from 'node:dgram';
import {EventEmitter, once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import DeviceObject from './DeviceObject.ts';
import eojSettings from './EojSettings.ts';
import {readJsonFileIfExists} from './FileUtils.ts';
import initValues from './InitValues.ts';
import IpAddressUtils from './IpAddressUtils.ts';
import packetComposer from './PacketComposer.ts';
import PacketLogger from './PacketLogger.ts';
import PacketParser from './PacketParser.ts';
import PacketSender from './PacketSender.ts';

/* ------------------------------------------------------------------
 * イベント:
 * - received(address, parsed)    : EL パケット受信
 * - sent(address, parsed)        : EL パケット送信
 * - epcupdated(data)             : EPC 更新
 * - powerstatuschanged(data)     : 電源状態変化
 * - discovered(data)             : リモートデバイス発見
 * - disappeared(data)            : リモートデバイスロスト
 * - remoteepcupdated(data)       : リモートデバイス EPC 更新
 * ---------------------------------------------------------------- */
class Device extends EventEmitter {
  _conf: any;
  _console: any;
  _controller_eoj: any;
  _current_eoj_list: any;
  _current_eoj_list_json: any;
  _device_objects: any;
  _initialized: any;
  _ip_address_utils: any;
  _is_controller: any;
  _mDeviceDescription: any;
  _mManufacturerTable: any;
  _packet_logger: any;
  _packet_sender: any;
  _parser: any;
  _power_status: any;
  _remote_devices: any;
  _request_callback_map: any;
  _request_interval_msec: any;
  _request_release_map: any;
  _request_retry_limit: any;
  _request_timeout_msec: any;
  _udp: any;
  instance_announce_timer: any;
  is_sending_property_notification: any;
  property_announce_timer: any;
  /* ------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */
  constructor(
    conf: any,
    mDeviceDescription: any,
    mManufacturerTable: any,
    console_obj: any,
  ) {
    super();

    // 設定情報
    this._conf = structuredClone(conf);

    // DeviceDescription
    this._mDeviceDescription = mDeviceDescription;

    // ManufacturerTable
    this._mManufacturerTable = mManufacturerTable;

    // Console
    this._console = console_obj;

    // デバイスオブジェクトのオブジェクトを格納したハッシュ
    this._device_objects = {};

    // 本インスタンスの init() が呼び出されたかどうかのフラグ
    this._initialized = false;

    // Dgram モジュールから生成する UDP オブジェクト
    this._udp = null;

    // IPアドレスユーティリティ
    this._ip_address_utils = null;

    // DeviceDescription パーサーオブジェクト
    this._parser = new PacketParser(
      this._mDeviceDescription,
      this._mManufacturerTable,
    );

    // EL パケット送受信ログオブジェクト
    this._packet_logger = null;

    // EOJ 情報をロード
    this._current_eoj_list_json = path.resolve(
      import.meta.dirname,
      '../data/current_eoj_list.json',
    );
    this._current_eoj_list = [];

    // EL パケット送信モジュールのインスタンス
    this._packet_sender = null;

    // ノードプロファイルが送信専用ノードの場合にインスタンスリスト通知アナウンス
    // を送信するためのタイマーオブジェクト
    this.instance_announce_timer = null;
    this.property_announce_timer = null;

    // 送信専用ノードの場合に、プロパティ通知送信中かどうかのフラグ
    this.is_sending_property_notification = false;

    // -----------------------------------------------------
    // 以下、コントローラーの場合のパラメータ
    // -----------------------------------------------------

    // コントローラーかどうかのフラグ
    this._is_controller = false;
    this._controller_eoj = '';

    // 発見したリモートの EL デバイス
    //  {
    //    "192.168.11.4": { // IP アドレス
    //      "01013501": {   // EOJ
    //        "get": [],    // Get をサポートした EPC のリスト (Get プロパティマップ)
    //        "set": [],    // Set をサポートした EPC のリスト (Set プロパティマップ)
    //        "inf": []     // Inf をサポートした EPC のリスト (状変アナウンスプロパティマップ)
    //      },
    //      ...
    //    },
    //    ...
    //  }
    this._remote_devices = {};

    // レスポンス受信を必要とするリクエストのコールバック
    //  キーは TID
    this._request_callback_map = {};
    this._request_release_map = {};

    // リモートデバイスへのリクエストのタイムアウト (ミリ秒)
    //this._request_timeout_msec = 5000;
    this._request_timeout_msec = this._conf['request_timeout_msec'];

    // リモートデバイスへ連続してリクエストする場合の間隔 (ミリ秒)
    //this._request_interval_msec = 1000;
    this._request_interval_msec = this._conf['request_interval_msec'];

    // リモートデバイスへのリクエストの最大リトライ回数
    // - もし 2 を指定したら、最大で 3 回リクエストを送ることになる。
    this._request_retry_limit = this._conf['request_retry_limit'];

    // 本エミュレーターのパワーステータス
    this._power_status = false;
  }

  // 設定情報が更新されたときの処理
  updateConf(conf: any): any {
    // 変更があったパラメータ名のリスト
    const changed_param_list: any = [];
    Object.keys(this._conf).forEach(k => {
      if (this._conf[k] !== conf[k]) {
        changed_param_list.push(k);
      }
    });

    // 初期化が必要かどうかを検証
    let init_required_flag = false;
    if (changed_param_list.indexOf('ip_address_version') >= 0) {
      init_required_flag = true;
    }
    if (changed_param_list.indexOf('instance_announce_interval_sec') >= 0) {
      init_required_flag = true;
    }
    if (changed_param_list.indexOf('property_announce_interval_sec') >= 0) {
      init_required_flag = true;
    }

    // 設定情報を更新
    this._conf = structuredClone(conf);

    // 初期化
    if (init_required_flag) {
      this._restart().catch((error: any) => {
        console.error(error);
      });
    } else {
      // 初期化の必要がないなら、依存しているモジュールに伝達
      Object.keys(this._device_objects).forEach(eoj => {
        const devobj = this._device_objects[eoj];
        devobj.updateConf(this._conf);
      });
    }
  }

  // デバイスを停止して初期化し、停止前に起動していれば再び起動する
  async _restart(): Promise<void> {
    const status = this.getPowerStatus();
    await this.stop();
    await this.init();
    if (status === true) {
      await this.start();
    }
  }

  /* ------------------------------------------------------------------
   * 初期化
   * init([eoj_list])
   * - instances | array  | optional | EOJ情報を格納したオブジェクトのリスト
   *   - eoj     | string | required | EOJを表す 16進数文字列 (例: "013001")
   *   - epc     | array  | optional | サポートするEPCのリスト。null ならすべてをサポート。
   *             |        |          | (例: ["80", "B0", "B1", "B3", ...])
   *
   * 例:
   *  init([
   *    {eoj: "013001", epc: ["80", "B0", "B1", "B3", ...]},
   *    {eoj: "013002", epc: ["80", "B0", "B1", "B3", ...]}
   *  ]);
   *
   *  - EOJ "0EF001" (Node profile class) は自動的に登録される。
   *  - eoj_list が指定されなかった場合は、/data/current_eoj_list.json が
   *    適用される。
   * ---------------------------------------------------------------- */
  async init(eoj_list?: any): Promise<void> {
    this._console.printSysInitMsg('Initializing a device...');

    this._request_callback_map = {};

    // EL パケット送受信ログオブジェクト
    if (this._conf['packet_log'] === true) {
      this._packet_logger = new PacketLogger(this._conf);
    }

    // IpAddressUtils
    this._ip_address_utils = new IpAddressUtils(
      this._conf['ip_address_version'],
    );

    // EOJ リスト
    let new_eoj_list = [];
    if (eoj_list && eoj_list.length > 0) {
      // EOJ リストのチェック
      const chk = this._checkEojList(eoj_list);
      if (chk['result'] !== 0) {
        this._console.printSysInitRes('NG');
        throw new Error(chk['message']);
      }
      new_eoj_list = chk['eojList'];
    } else {
      // EOJ リストの読み取り
      try {
        const list = readJsonFileIfExists(this._current_eoj_list_json);
        if (list && Array.isArray(list) && list.length > 0) {
          new_eoj_list = list;
        }
      } catch (error) {
        this._console.printSysInitRes('NG');
        throw error;
      }
    }

    // EOJ リストに Node profile class のオブジェクトが存在するかをチェック (0EF0XX)
    //  ついでにコントローラー (05FFXX) かどうかもチェック
    let node_profile_eoj = '';
    this._is_controller = false;
    for (let i = 0; i < new_eoj_list.length; i++) {
      const eoj = new_eoj_list[i]['eoj'];
      if (/^0EF0/.test(eoj)) {
        node_profile_eoj = eoj;
      }
      if (/^05FF/.test(eoj)) {
        this._is_controller = true;
        this._controller_eoj = eoj;
      }
    }

    // EOJ リスト情報に EOJ が 1 つもなければ家庭用エアコンを追加
    if (new_eoj_list.length === 0) {
      const desc = this._mDeviceDescription.getEoj('0130');
      new_eoj_list.push({
        eoj: '013001',
        epc: Object.keys(desc['elProperties']),
        release: this._mDeviceDescription.getRelease(),
      });
    }

    // コントローラーなら他の EOJ は削除 (Node profile は削除しない)
    if (this._is_controller) {
      const new_eoj_list2 = [];
      for (let i = 0; i < new_eoj_list.length; i++) {
        const eoj = new_eoj_list[i]['eoj'];
        if (/^(05FF|0EF0)/.test(eoj)) {
          new_eoj_list2.push(new_eoj_list[i]);
        }
      }
      new_eoj_list = new_eoj_list2;
    }

    // EOJ リスト情報に Node profile がなければ追加 (0EF001)
    if (!node_profile_eoj) {
      node_profile_eoj = '0EF001';
      const desc = this._mDeviceDescription.getEoj(node_profile_eoj);
      new_eoj_list.unshift({
        eoj: node_profile_eoj,
        epc: Object.keys(desc['elProperties']),
        release: this._mDeviceDescription.getRelease(),
      });
    }

    // EOJ 0x0EF0 (ノードプロファイル) の EPC 0xBF (個体識別番号) を除外
    new_eoj_list.forEach((eoj_desc: any) => {
      const eoj = eoj_desc['eoj'];
      if (/^0EF0/.test(eoj)) {
        const new_epc_list: any = [];
        eoj_desc['epc'].forEach((epc: any) => {
          if (epc !== 'BF') {
            new_epc_list.push(epc);
          }
        });
        eoj_desc['epc'] = new_epc_list;
      }
    });

    // EOJ リスト情報をファイルに書き込む
    const eoj_list_txt = JSON.stringify(new_eoj_list, null, '  ');
    await fs.promises.writeFile(
      this._current_eoj_list_json,
      eoj_list_txt,
      'utf-8',
    );
    this._current_eoj_list = new_eoj_list;

    // EOJ ごとにインスタンスを生成
    this._device_objects = {};
    new_eoj_list.forEach((ins: any) => {
      const eoj = ins['eoj'];
      const release = ins['release'];
      // EPC の初期値
      const user_init_values = initValues.get(eoj);
      const desc = this._mDeviceDescription.getEoj(eoj, ins['epc'], release);
      const devobj = new DeviceObject(
        eoj,
        desc,
        user_init_values,
        this._conf,
        this._ip_address_utils,
        release,
        this._parser,
        eojSettings.get(eoj),
      );
      devobj.init();
      this._device_objects[eoj] = devobj;
    });

    // デバイスオブジェクトのインスタンスに各種イベントハンドラをセット
    Object.keys(this._device_objects).forEach(eoj => {
      const devobj = this._device_objects[eoj];
      // パケット送信のイベントハンドラをセット
      devobj.on('send', (address: any, packet: any) => {
        const buf = packetComposer.compose(packet);
        if (buf) {
          this.send(address, buf).catch(() => {
            // Do nothing
          });
        }
      });
      // EPC 更新イベントハンドラをセット
      devobj.on('epcupdated', (eoj: any, props: any) => {
        this.emit('epcupdated', {
          eoj: eoj,
          properties: props,
        });
      });
    });

    // パケットログオブジェクトの初期化
    if (this._packet_logger) {
      this._packet_logger.init();
    }

    // Node profile class の EPC 初期値をセット
    try {
      await this._initNodeProfileInstance(
        this._device_objects[node_profile_eoj],
      );
    } catch (error) {
      this._console.printSysInitRes('NG');
      throw error;
    }
    this._initialized = true;
    this._console.printSysInitRes('OK');

    for (const eoj_info of this.getCurrentEojList()) {
      const o = this._mDeviceDescription.getEoj(eoj_info['eoj']);
      const eoj_name = o['className'][this._conf['lang']];
      this._console.printSysInfo(
        '  - ' + eoj_info['eoj'] + ' (' + eoj_name + ')',
      );
    }
  }

  async _initNodeProfileInstance(devobj: any): Promise<any> {
    // サポートする EOJ のリストとノードクラスのリスト
    const eoj_list = [];
    const class_hash: any = {};

    for (const eoj of Object.keys(this._device_objects)) {
      eoj_list.push(eoj);
      const class_code = eoj.substring(0, 4);
      class_hash[class_code] = true;
    }

    const eoj_num = eoj_list.length;
    const class_list = Object.keys(class_hash);
    const class_num = class_list.length;
    const props = [];

    // EPC 0xD3 自ノードインスタンス数 (3バイト) (ノードプロファイルを除く)
    const d3 = Buffer.alloc(4);
    d3.writeUInt32BE(eoj_num - 1, 0);
    props.push({
      epc: 'D3',
      edt: d3.subarray(1, 4).toString('hex').toUpperCase(),
    });

    // EPC 0xD4 自ノードクラス数 (2バイト) (ノードプロファイルを含む)
    const d4 = Buffer.alloc(2);
    d4.writeUInt16BE(class_num);
    props.push({
      epc: 'D4',
      edt: d4.toString('hex').toUpperCase(),
    });

    // EPC 0xD5 インスタンスリスト通知 (ノードプロファイルを除く)
    // EPC 0xD6 自ノードインスタンスリストS (ノードプロファイルを除く)
    const d6 = [];
    let d6_eoj_num = eoj_num - 1;
    if (d6_eoj_num > 255) {
      d6_eoj_num = 255;
    }
    const d6_eoj_list_full = structuredClone(eoj_list);
    let d6_eoj_list = [];
    for (const eoj of d6_eoj_list_full) {
      if (!/^0EF0/.test(eoj)) {
        d6_eoj_list.push(eoj);
      }
    }

    if (eoj_num > 84) {
      d6_eoj_list = d6_eoj_list.slice(0, 85);
    }

    d6.push(Buffer.from([d6_eoj_num]).toString('hex'));
    for (const e of d6_eoj_list) {
      d6.push(e);
    }

    props.push({
      epc: 'D5',
      edt: d6.join('').toUpperCase(),
    });

    props.push({
      epc: 'D6',
      edt: d6.join('').toUpperCase(),
    });

    // EPC 0xD7 自ノードクラスリストS (ノードプロファイルを除く)
    const d7 = [];
    let d7_class_num = class_num - 1;
    if (d7_class_num > 255) {
      d7_class_num = 255;
    }
    const d7_class_list_full = structuredClone(class_list);
    let d7_class_list: any = [];
    d7_class_list_full.forEach((c: any) => {
      if (!/^0EF0/.test(c)) {
        d7_class_list.push(c);
      }
    });

    if (d7_class_num > 8) {
      d7_class_list = d7_class_list.slice(0, 9);
    }
    d7.push(Buffer.from([d7_class_num]).toString('hex'));
    d7_class_list.forEach((c: any) => {
      d7.push(c);
    });
    props.push({
      epc: 'D7',
      edt: d7.join('').toUpperCase(),
    });

    const res = await devobj.setEpcValues(props, true);
    return res;
  }

  // EOJ リストの妥当性チェック
  _checkEojList(eoj_list: any): any {
    if (!eoj_list || !Array.isArray(eoj_list) || eoj_list.length === 0) {
      return {
        result: 1,
        message: 'The parameter `eojList` must be a non-empty array.',
      };
    }

    // リリースバージョンの範囲を取得
    const release_list = this._mDeviceDescription.getReleaseList();
    // 最新のリリースバージョンを特定
    const latest_release = release_list[release_list.length - 1];

    const new_eoj_list = [];

    let err = '';
    for (let i = 0; i < eoj_list.length; i++) {
      const ins = eoj_list[i];
      if (typeof ins !== 'object') {
        err = 'Each element in the `eojList` must be an object.';
        break;
      }

      // リリースバージョンのチェック
      let release = latest_release;
      if ('release' in ins) {
        release = ins['release'];
      }
      if (release_list.indexOf(release) < 0) {
        err = 'The `release` must be between `A` and `' + latest_release + '`.';
      }

      // EOJ のチェック
      if (!('eoj' in ins)) {
        err = 'The `eoj` is required.';
        break;
      }
      let eoj = ins['eoj'];
      if (typeof eoj !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(eoj)) {
        err = 'The `eoj` is invalid as an EOJ: ' + eoj;
        break;
      }
      eoj = eoj.toUpperCase();
      const desc = this._mDeviceDescription.getEoj(eoj, ins['epc']);
      if (!desc) {
        err = 'The `eoj` is unknown: ' + eoj;
        break;
      }

      if (release < desc['firstRelease']) {
        err =
          'The EOJ `' +
          eoj +
          '` was available from the release `' +
          desc['firstRelease'] +
          '`.';
        break;
      }

      // EPC リスト
      const o = this._mDeviceDescription.getEoj(eoj, null, release);
      // パラメータ `epc` が指定されていなければ、すべての EPC を適用
      let epc_list = Object.keys(o['elProperties']);
      // パラメータ `epc` が指定されていれば、EPC をフィルター
      /*
            if ('epc' in ins) {
              let list = ins['epc'];
              if (!Array.isArray(list)) {
                err = 'The `epc` must be a non-empty array.';
                break;
              }
              let filtered_list = [];
              list.forEach((epc_hex) => {
                if (typeof (epc_hex) !== 'string' || !/^[0-9A-Fa-f]{2}$/.test(epc_hex)) {
                  err = 'Each element in the `epc` must be `FF` format.';
                } else {
                  epc_hex = epc_hex.toUpperCase();
                  if(epc_list.indexOf(epc_hex) >= 0) {
                    filtered_list.push(epc_hex);
                  } else {
                    err = 'The specified EPC `' + epc_hex + '` is not supported in the Release Version `' + release + '`.';
                  }
                }
              });
              epc_list = filtered_list;
            }
            */

      if ('epc' in ins) {
        const list = ins['epc'];
        if (!Array.isArray(list)) {
          err = 'The `epc` must be a non-empty array.';
          break;
        }
        // required の EPC だけを抽出する
        const required_epc_map: any = {};
        Object.keys(o['elProperties']).forEach(epc_hex => {
          const epc_data = o['elProperties'][epc_hex];
          const rule = epc_data['accessRule'];
          if (rule) {
            let required = false;
            Object.keys(rule).forEach(r => {
              //if (rule[r] === 'required') {
              if (rule[r].startsWith('required')) {
                required = true;
              }
            });
            if (!required) {
              return;
            }
          }
          required_epc_map[epc_hex] = true;
        });

        const new_list: any = [];
        list.forEach(epc_hex => {
          if (
            typeof epc_hex !== 'string' ||
            !/^[0-9A-Fa-f]{2}$/.test(epc_hex)
          ) {
            err = 'Each element in the `epc` must be `FF` format.';
          } else {
            epc_hex = epc_hex.toUpperCase();
            if (epc_list.indexOf(epc_hex) >= 0) {
              new_list.push(epc_hex);
            } else {
              err =
                'The specified EPC `' +
                epc_hex +
                '` is not supported in the Release Version `' +
                release +
                '`.';
            }
          }
        });
        new_list.forEach((epc_hex: any) => {
          if (!required_epc_map[epc_hex]) {
            required_epc_map[epc_hex] = true;
          }
        });
        epc_list = Object.keys(required_epc_map);
        epc_list.sort();
      }

      if (err) {
        break;
      } else {
        new_eoj_list.push({
          eoj: eoj,
          epc: epc_list,
          release: release,
        });
      }
    }

    if (err) {
      return {
        result: 1,
        message: err,
      };
    } else {
      return {
        result: 0,
        eojList: new_eoj_list,
      };
    }
  }

  /* ------------------------------------------------------------------
   * reset()
   * デバイスをリセットする。
   * - elemu/data/ 内に保存された current_eoj_list.json, state_XXXXXX.json
   *  を削除してから、デバイスを再起動する。
   *
   * 引数
   *   なし
   *
   * 戻値
   *   Promise オブジェクト
   *
   *   resolve() には何も引き渡さない。
   * ---------------------------------------------------------------- */
  async reset(): Promise<void> {
    const status = this.getPowerStatus();
    await this.stop();

    // 保存された EOJ リストと状態ファイルを削除
    const dpath = path.resolve(import.meta.dirname, '../data');
    const fname_list = await fs.promises.readdir(dpath);
    await Promise.all(
      fname_list
        .filter(
          fname =>
            fname === 'current_eoj_list.json' ||
            /^state_[0-9a-fA-F]{6}\.json$/.test(fname),
        )
        .map(fname => fs.promises.rm(path.join(dpath, fname), {force: true})),
    );

    this._remote_devices = {};
    await this.init();
    if (status === true) {
      await this.start();
    }
  }

  /* ------------------------------------------------------------------
   * getCurrentEojList()
   * 現在セットされている EOJ 情報のリストを取得する
   *
   * 引数:
   *   なし
   *
   * 戻値:
   *   this._current_eoj_list の内容をそのまま返す
   *     [
   *       {
   *         "eoj": "031001",
   *         "epc": ["80", "81",...],
   *         "release": "J"
   *       },
   *       ...
   *     ]
   * ---------------------------------------------------------------- */
  getCurrentEojList(): any {
    return structuredClone(this._current_eoj_list);
  }

  /* ------------------------------------------------------------------
   * getCurrentEoj(epc)
   * 現在セットされている EOJ 情報のリストから指定の EOJ の情報を取得する
   *
   * 引数:
   *   epc: EPC の 16 進数文字列
   *
   * 戻値:
   *   this._current_eoj_list のうち、指定の EOJ に該当するオブジェクトの
   *   内容をそのまま返す。
   *     { "eoj": "031001", "epc": ["80", "81",...]},
   *   もし指定の EOJ が見つからなければ null を返す。
   * ---------------------------------------------------------------- */
  getCurrentEoj(eoj: any): any {
    eoj = eoj.toUpperCase();
    let o = null;
    for (let i = 0, len = this._current_eoj_list.length; i < len; i++) {
      const obj = this._current_eoj_list[i];
      if (obj['eoj'] === eoj) {
        o = structuredClone(obj);
        break;
      }
    }
    return o;
  }

  /* ------------------------------------------------------------------
   * addCurrentEoj(params)
   * EOJ 情報を追加してデバイスを再起動する。
   *
   * - ノードプロファイル (EOJ: 0x0EF0XX) を指定すると、既存のノードプロ
   *   ファイルを置き換える。
   * - コントローラー (EOJ: 0x05FFXX) を登録する場合は、ノードプロファイルを
   *   除くすべての EOJ を事前に削除しておかなければいけない。
   * - コントローラー (EOJ: 0x05FFXX) がすでに登録されている場合は、もう EOJ
   *   は追加できない。
   *
   * 引数:
   * - params
   *   - eoj     | String | required | EOJ の 16 進数文字列
   *   - epc     | Array  | optional | サポートする EPC のリスト
   *             |        |          | 指定がなければ全 EPC をサポート対象とする
   *   - release | String | optional | リリースバージョン (例: "J")
   *             |        |          | 指定がなければ DeviceDescription の
   *             |        |          | リリースバージョンが適用される
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * 指定された EOJ の値が不正な値だったとしても reject() ではなく resolve() を
   * 呼び出す。reject() が呼び出されるのは、ファイル書き込みに失敗したときなど。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   *   result    | Interger | 成功なら 0 が、失敗なら 1 がセットされる
   *   data      | Object   | 失敗の場合は存在しない
   *     eoj     | String   | 追加した EOJ
   *     epc     | Array    | 追加した EOJ がサポートする EPC のリスト
   *     release | String   | ECHONET Lite 仕様書 Appendix のリリースバージョン (例: "J")
   *   message   | String   | エラーメッセージ (成功の場合は存在しない)
   * ---------------------------------------------------------------- */
  async addCurrentEoj(params: any): Promise<any> {
    const chk = this._checkEojList([params]);
    if (chk['result'] !== 0) {
      return chk;
    }
    const o = chk['eojList'][0];
    const eoj_hex = o['eoj'];
    if (this.getCurrentEoj(eoj_hex)) {
      return {
        result: 1,
        message: 'The specified EOJ has been already registered: ' + eoj_hex,
      };
    }

    let eoj_list = this.getCurrentEojList();

    // 追加したい EOJ がノードプロファイルかどうかをチェック
    let is_node_profile_added = false;
    if (/^0EF0/.test(eoj_hex)) {
      is_node_profile_added = true;
      // インスタンス番号は 01 か 02 のいずれか
      if (!/^0EF0(01|02)$/.test(eoj_hex)) {
        return {
          result: 1,
          message:
            'The instance number for The node profile class (`0EF0`) must be `01` or `02`.',
        };
      }
    }

    // いま、コントローラーかどうかを調べる
    let is_controller = false;
    for (let i = 0; i < eoj_list.length; i++) {
      const eoj_data = eoj_list[i];
      if (/^05FF/.test(eoj_data['hex'])) {
        is_controller = true;
        break;
      }
    }
    // コントローラーならノードプロファイル以外の EOJ は追加できない
    if (is_controller) {
      if (!is_node_profile_added) {
        return {
          result: 1,
          message:
            'When this emulator is started as a controller, no EOJs can be added except a Node Profile.',
        };
      }
    }

    // コントローラーを追加する場合、ノードプロファイル以外の EOJ が
    // 登録されていないかをチェック
    if (/^05FF/.test(eoj_hex)) {
      let err = '';
      for (let i = 0; i < eoj_list.length; i++) {
        const eoj_data = eoj_list[i];
        if (!/^0EF0/.test(eoj_data['eoj'])) {
          err =
            'If you want to add a controller class (EOJ: `' +
            eoj_hex +
            '`), delete the other EOJs except the node profile class (EOJ: `0EF0XX`) in advance.';
          break;
        }
      }
      if (err) {
        return {
          result: 1,
          message: err,
        };
      }
    }

    // 登録情報を構築
    if (is_node_profile_added) {
      const new_eoj_list: any = [];
      eoj_list.forEach((eoj_data: any) => {
        if (/^0EF0/.test(eoj_data['eoj'])) {
          new_eoj_list.push(o);
        } else {
          new_eoj_list.push(eoj_data);
        }
      });
      eoj_list = new_eoj_list;
    } else {
      eoj_list.push(o);
    }
    // 登録処理とデバイス再起動
    const res = await this.setCurrentEojList(eoj_list);
    if (res['result'] === 0) {
      res['data'] = this.getCurrentEoj(eoj_hex);
    }
    return res;
  }

  /* ------------------------------------------------------------------
   * updateCurrentEoj(params)
   * EOJ 情報 (EPC リスト) を修正してデバイスを再起動する
   *
   * 引数:
   * - params
   *   - eoj     | String | required | EOJ の 16 進数文字列
   *   - epc     | Array  | optional | サポートする EPC のリスト
   *             |        |          | 指定がなければ全 EPC をサポート対象とする
   *   - release | String | optional | リリースバージョン (例: "J")
   *             |        |          | 指定がなければ DeviceDescription の
   *             |        |          | リリースバージョンが適用される
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * 指定された EOJ の値が不正な値だったとしても reject() ではなく resolve() を
   * 呼び出す。reject() が呼び出されるのは、ファイル書き込みに失敗したときなど。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   *   result    | Interger | 成功なら 0 が、失敗なら 1 がセットされる
   *             |          | 指定の EOJ が見つからない場合は 404 がセットされる
   *   data      | Object   | 失敗の場合は存在しない
   *     eoj     | String   | 修正した EOJ
   *     epc     | Array    | 修正した EOJ がサポートする EPC のリスト
   *   message   | String   | エラーメッセージ (成功の場合は存在しない)
   * ---------------------------------------------------------------- */
  async updateCurrentEoj(params: any): Promise<any> {
    const chk = this._checkEojList([params]);
    if (chk['result'] !== 0) {
      return chk;
    }

    const o = chk['eojList'][0];
    const eoj = o['eoj'];

    if (!this.getCurrentEoj(eoj)) {
      return {
        result: 404,
        message: 'The specified EOJ has not been registered: ' + eoj,
      };
    }

    const eoj_list = this.getCurrentEojList();
    for (let i = 0, len = eoj_list.length; i < len; i++) {
      if (eoj_list[i]['eoj'] === eoj) {
        eoj_list[i] = o;
      }
    }

    const res = await this.setCurrentEojList(eoj_list);
    if (res['result'] === 0) {
      res['data'] = this.getCurrentEoj(eoj);
    }
    return res;
  }

  /* ------------------------------------------------------------------
   * deleteCurrentEoj(epc)
   * 現在セットされている EOJ 情報のリストから指定の EOJ の情報を削除する
   * - ノードプロファイルは削除できない。
   *
   * 引数:
   *   epc: EPC の 16 進数文字列
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * 指定された EOJ の値が不正な値だったとしても reject() ではなく resolve() を
   * 呼び出す。reject() が呼び出されるのは、ファイル書き込みに失敗したときなど。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   *   result    | Interger | 成功なら 0 が、失敗なら 1 がセットされる
   *             |          | 指定の EOJ が見つからない場合は 404 がセットされる
   *   data      | Object   | 失敗の場合は存在しない
   *     eoj     | String   | 削除した EOJ
   *     epc     | Array    | 削除した EOJ がサポートする EPC のリスト
   *   message   | String   | エラーメッセージ (成功の場合は存在しない)
   * ---------------------------------------------------------------- */
  async deleteCurrentEoj(eoj: any): Promise<any> {
    if (!eoj || typeof eoj !== 'string' || !/^([0-9A-Fa-f]{6})$/.test(eoj)) {
      return {
        result: 1,
        message: 'The specified EOJ is invalid: ' + eoj,
      };
    }

    eoj = eoj.toUpperCase();
    const o = this.getCurrentEoj(eoj);
    if (!o) {
      return {
        result: 404,
        message: 'The specified EOJ has not been registered: ' + eoj,
      };
    }

    if (/^0EF0/.test(eoj)) {
      return {
        result: 403,
        message: 'The node profile can not be deleted.',
      };
    }

    const deleted = structuredClone(o);

    const eoj_list = this.getCurrentEojList();
    const new_eoj_list = [];
    for (let i = 0, len = eoj_list.length; i < len; i++) {
      if (eoj_list[i]['eoj'] !== eoj) {
        new_eoj_list.push(eoj_list[i]);
      }
    }

    const res = await this.setCurrentEojList(new_eoj_list);
    if (res['result'] === 0) {
      res['data'] = deleted;
    }
    return res;
  }

  /* ------------------------------------------------------------------
   * setCurrentEojList(eoj_list)
   * EOJ 情報のリストを一括でセットしてデバイスを再起動する
   *
   * - ノードプロファイル (EOJ: 0x0EF001) は自動的に登録されるため、指定する
   *   必要はない (指定することも可能)。
   * - 登録可能なノードプロファイルの EOJ は 0x0EF001 (一般ノード) か
   *   0x0EF002 (送信専用ノード) のいずれか一方のみ。
   * - コントローラー (EOJ: 0x05FFXX) が含まれる場合は、それ以外の EOJ は指定
   *   できない。
   *
   * 引数:
   * - eoj_list = [
   *     {
   *       "eoj": "013001",
   *       "epc": ["80", "81", ...],
   *       "release": "J"
   *     },
   *     ...
   *   ]
   *
   *   - "epc" はオプションで、指定がなければすべての EPC が適用される。
   *   - "epc" は指定するなら 1 つ以上の要素がある Array でなければいけない。
   *   - "release" はオプションで指定がなければ DeviceDescription のリリース
   *     バージョンが適用される。(例: "J")
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * 指定された EOJ の値が不正な値だったとしても reject() ではなく resolve() を
   * 呼び出す。reject() が呼び出されるのは、ファイル書き込みに失敗したときなど。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   *   result    | Interger | 成功なら 0 が、失敗なら 1 がセットされる
   *   data      | Object   | 失敗の場合は存在しない
   *     eojList | Array    | 設定した EOJ のリスト
   *   message   | String   | エラーメッセージ (成功の場合は存在しない)
   * ---------------------------------------------------------------- */
  async setCurrentEojList(eoj_list: any): Promise<any> {
    // EOJ リストをチェック
    const chk = this._checkEojList(eoj_list);
    if (chk['result'] !== 0) {
      return chk;
    }
    const checked_eoj_list = chk['eojList'];

    const eoj_hex_map: any = {};
    let controller_eoj_hex = '';
    let node_profile_num = 0;
    let err = '';

    for (const eoj_data of checked_eoj_list) {
      const eoj_hex = eoj_data['eoj'];

      // ノードプロファイルが2つ以上指定されていないかをチェック
      if (/^0EF0/.test(eoj_hex)) {
        node_profile_num++;
        if (node_profile_num > 1) {
          err = node_profile_num + ' node profiles are specified.';
          break;
        }

        // ノードプロファイルのインスタンス番号が 01 か 02 のいずれかであることをチェック
        if (!/^0EF0(01|02)$/.test(eoj_hex)) {
          err =
            'The EOJ of the node profile class must be `0x0EF001` or `0x0EF002`.';
          break;
        }
      }

      // EOJ が重複していないかをチェック
      if (eoj_hex in eoj_hex_map) {
        err = 'The EOJ `' + eoj_hex + '` is overlapped.';
        break;
      }

      if (/^05FF/.test(eoj_hex)) {
        controller_eoj_hex = eoj_hex;
      }

      eoj_hex_map[eoj_hex] = eoj_data;
    }

    // コントローラーが指定されているにもかかわらず、ノードプロファイルを除く他の EOJ が指定されていないかをチェック
    let device_eoj_num = 0;
    for (const eoj_data of checked_eoj_list) {
      const eoj_hex = eoj_data['eoj'];
      if (!/^(0EF0|05FF)/.test(eoj_hex)) {
        device_eoj_num++;
      }
    }

    if (controller_eoj_hex && device_eoj_num > 0) {
      err =
        'When the controller class (EOJ: `' +
        controller_eoj_hex +
        '`) is registered, other EOJs can not be registered except a node profile class (0x0EF0XX).';
    }
    if (err) {
      return {
        result: 1,
        message: err,
      };
    }

    const status = this.getPowerStatus();
    await this.stop();
    await this.init(checked_eoj_list);
    const new_eoj_list = this.getCurrentEojList();
    if (status === true) {
      await this.start();
    }
    return {
      result: 0,
      data: {
        eojList: new_eoj_list,
      },
    };
  }

  /* ------------------------------------------------------------------
   * start()
   * デバイスを起動する
   * - すでに起動していた場合、何もせずに resolve する。
   * ---------------------------------------------------------------- */
  async start(): Promise<void> {
    this._console.printSysInitMsg('Starting the device...');

    if (this._initialized === false) {
      this._console.printSysInitRes('NG');
      throw new Error('This object has not been initialized.');
    }

    if (this._udp) {
      this._console.printSysInitRes('OK');
      this._power_status = true;
      return;
    }

    // UDP/Datagram Sockets を生成
    let udp_version: 'udp4' | 'udp6' = 'udp4';
    if (this._conf['ip_address_version'] === 6) {
      udp_version = 'udp6';
    }
    this._udp = dgram.createSocket(udp_version);
    this._packet_sender = new PacketSender(
      this._conf,
      this._udp,
      this._ip_address_utils,
    );

    this._udp.on('message', (buf: any, device_info: any) => {
      this._receivePacket(buf, device_info);
    });

    const port = this._ip_address_utils.getPortNumber();
    this._udp.bind(port);
    try {
      await once(this._udp, 'listening');
    } catch (error) {
      this._console.printSysInitRes('NG');
      throw error;
    }
    this._addMembership();

    // インスタンスリスト通知 (EPC: 0xD5) のための EOJ リストを生成
    // (ノードプロファイルを除く EOJ のリスト)
    const eoj_list: any = [];
    let node_profile_eoj = '';
    this._current_eoj_list.forEach((o: any) => {
      if (/^0EF0/.test(o['eoj'])) {
        node_profile_eoj = o['eoj'];
      } else {
        eoj_list.push(o['eoj']);
      }
    });

    if (eoj_list.length > 0) {
      // インスタンスリスト通知 (EPC: 0xD5) INF を生成してマルチキャスト送信
      // - 本エミュレーターをコンソールから起動したときに、システム起動完了前に
      //   パケット送受信が発生するのを避けるため、1秒後にマルチキャスト送信
      // - マルチキャスト送信完了を待たずに return する
      setTimeout(async () => {
        try {
          await this._sendInstanceListNotification(node_profile_eoj, eoj_list);
        } catch (error) {
          console.error(error);
          process.exit();
        }
        this.emit('powerstatuschanged', {
          powerStatus: true,
        });
        // EOJ が送信専用ノード (0x0EF002) なら定期的に送信
        if (node_profile_eoj === '0EF002') {
          this.instance_announce_timer = setInterval(() => {
            this._sendInstanceListNotification(
              node_profile_eoj,
              eoj_list,
            ).catch((error: any) => {
              console.error(error);
            });
          }, this._conf['instance_announce_interval_sec'] * 1000);
        }
      }, 1000);

      // EOJ が送信専用ノード (0x0EF002) なら定期的にプロパティ通知を送信
      if (node_profile_eoj === '0EF002') {
        setTimeout(() => {
          this._sendPropertyNotification(eoj_list);
          this.property_announce_timer = setInterval(() => {
            this._sendPropertyNotification(eoj_list);
          }, this._conf['property_announce_interval_sec'] * 1000);
        }, 2000);
      }
    }

    this._console.printSysInitRes('OK');
    this.emit('powerstatuschanged', {
      powerStatus: true,
    });

    this._power_status = true;

    // IPv6 モードならマルチキャスト送信のネットワークインタフェースをセット
    //if (this._conf['ip_address_version'] === 6) {
    //    this.setMulticastInterface6();
    //}
  }

  // IPv6 モードならマルチキャスト送信のネットワークインタフェースをセット
  /*
    setMulticastInterface6() {
        if (this._conf['ip_address_version'] !== 6) {
            return;
        }
        let scope_list = this._ip_address_utils.getNetworkScopeList();
        scope_list.forEach((s) => {
            this._udp.setMulticastInterface(s);
        });
    }
    */

  _sendInstanceListNotification(
    node_profile_eoj: any,
    eoj_list: any,
  ): Promise<any> {
    const buf = this._createInstanceListNotificationPacket(
      node_profile_eoj,
      eoj_list,
    );
    return this.send(null, buf);
  }

  // 送信専用ノードの場合にプロパティ通知を送信
  async _sendPropertyNotification(eoj_list: any): Promise<void> {
    // eoj_list = ["000D01"]
    if (this.is_sending_property_notification) {
      return;
    }

    const devobjs: any = {};
    eoj_list.forEach((eoj_hex: any) => {
      const devobj = this._device_objects[eoj_hex];
      if (devobj) {
        devobjs[eoj_hex] = devobj;
      }
    });
    if (eoj_list.length === 0) {
      return;
    }

    this.is_sending_property_notification = true;

    const common_desc = this._mDeviceDescription.getCommon();

    const propdescs: any = {};
    for (const eoj_hex in devobjs) {
      const eoj_desc = this._mDeviceDescription.getEoj(eoj_hex);
      const pdescs: any = {};
      // スーパークラスのプロパティ (common) を除外
      for (const epc_hex in eoj_desc['elProperties']) {
        if (!common_desc['elProperties'][epc_hex]) {
          pdescs[epc_hex] = eoj_desc['elProperties'][epc_hex];
        }
      }
      propdescs[eoj_hex] = pdescs;
    }

    const packet_buf_list: any = [];
    for (const eoj_hex of Object.keys(devobjs)) {
      const props = [];
      for (const epc_hex in propdescs[eoj_hex]) {
        props.push({epc: epc_hex, edt: null});
      }
      let res;
      try {
        res = await devobjs[eoj_hex].getEpcValues(props, true);
      } catch (error) {
        console.error(error);
        continue;
      }
      const vals = res['vals'];
      for (const epc_hex in vals) {
        const edt_hex = vals[epc_hex];
        if (!edt_hex) {
          continue;
        }
        const buf = packetComposer.compose({
          seoj: eoj_hex,
          deoj: '0EF001',
          esv: 'INF',
          properties: [
            {
              epc: epc_hex,
              edt: edt_hex,
            },
          ],
        });
        packet_buf_list.push(buf);
      }
    }

    for (const buf of packet_buf_list) {
      try {
        await this.send(null, buf);
      } catch (error) {
        console.error(error);
      }
    }
    this.is_sending_property_notification = false;
  }

  // EL パケットを受信したときの処理
  _receivePacket(buf: any, device_info: any): any {
    // 本デバイスがパワーオフの状態なら無視
    if (this._power_status === false) {
      return;
    }

    // 送信元アドレス
    const address = device_info.address;
    // 自分自身が送信したパケットなら無視
    if (this._ip_address_utils.isLocalAddress(address)) {
      return;
    }

    // EL パケットをパース
    let parsed = this._parser.parse(buf);

    // コンソールに出力
    if (this._conf['console-packet'] === true) {
      if (parsed['result'] === 0) {
        this._console.printPacketRx(address, parsed['data']['hex']);
      } else {
        this._console.printPacketRx(address, parsed['hex']);
      }
    }

    // パースに失敗した場合
    if (parsed['result'] !== 0) {
      // パケットエラーログに出力
      if (this._packet_logger) {
        this._packet_logger.rxError(address, parsed);
      }
      // `err` が `OPC_OVERFLOW` なら SNA を返す
      if (parsed['err'] === 'OPC_OVERFLOW') {
        if (parsed['data']) {
          this._sendSnaForOpcOverflow(address, parsed);
        }
      }
      // EL パケット受信イベントを発火
      this.emit('received', address, parsed);
      return;
    }

    // 自身がコントローラーの場合
    // リモートデバイス側の規格 Version 情報が分かっていれば、再度、パケットをパースしなおす
    if (this._is_controller) {
      const tid = parsed['data']['data']['tid']['hex'];
      if (this._request_release_map[tid]) {
        const release = this._request_release_map[tid];
        parsed = this._parser.parse(buf, release);
        delete this._request_release_map[tid];
      }
    }

    // EL パケットをログに出力
    if (this._packet_logger) {
      this._packet_logger.rx(address, parsed);
    }
    // 対象のデバイスオブジェクトがあれば情報を送る
    const el = parsed['data']['data'];
    const deoj = el['deoj']['hex'];
    if (/00$/.test(deoj)) {
      const c = deoj.substr(0, 4);
      Object.keys(this._device_objects).forEach(eoj => {
        if (c === eoj.substr(0, 4)) {
          this._device_objects[eoj].receive(address, parsed);
        }
      });
    } else {
      if (this._device_objects[deoj]) {
        this._device_objects[deoj].receive(address, parsed);
      }
    }

    // EL パケット受信イベントを発火
    this.emit('received', address, parsed);

    // リモートデバイスの状変アナウンス (ESV: 0x73) ならリモートデバイス EPC 更新イベントを発火
    if (el['esv']['hex'] === '73') {
      const prop_list: any = [];
      el['properties'].forEach((p: any) => {
        prop_list.push({
          epc: p['epc']['hex'],
          propertyName: p['epc']['propertyName'],
          edt: p['edt'],
        });
      });
      if (prop_list.length > 0) {
        const seoj = el['seoj']['hex'];
        this.emit('remoteepcupdated', {
          address: address,
          eoj: seoj,
          elProperties: prop_list,
        });
      }
    }

    // コントローラーの場合
    if (this._is_controller) {
      this._receivePacketForController(parsed, device_info);
    }
  }

  _addMembership(): any {
    /*
        if(this._conf['ip_address_version'] !== 4) {
          return;
        }
        */
    try {
      const netif_list = this._ip_address_utils.getNetworkInterfaceList();
      const mc_address = this._ip_address_utils.getMulticastAddress();
      netif_list.forEach((netif: any) => {
        try {
          this._udp.addMembership(mc_address, netif);
        } catch {
          // Failed to join the multicast group on the network interface
        }
      });
    } catch {}
  }

  _dropMembership(): any {
    /*
        if(this._conf['ip_address_version'] !== 4) {
          return;
        }
        */
    try {
      const netif_list = this._ip_address_utils.getNetworkInterfaceList();
      const mc_address = this._ip_address_utils.getMulticastAddress();
      netif_list.forEach((netif: any) => {
        try {
          this._udp.dropMembership(mc_address, netif);
        } catch {
          // Failed to leave the multicast group on the network interface
        }
      });
    } catch {}
  }

  _createInstanceListNotificationPacket(seoj: any, eoj_list: any): any {
    /* -------------------------------------------------------
     * ECHONET Lite 仕様書
     * - 第5部 4.2 ノードからコントローラへのメッセージ送信による検出
     * - 第2部 4.3.1 ECHONET Lite ノードスタート時の基本シーケンス
     * - 第2部 6.11.1 ノードプロファイルクラス詳細規定
     * ----------------------------------------------------- */
    if (!seoj || !/^0EF00(1|2)$/.test(seoj)) {
      seoj = '0EF001';
    }
    const edt =
      Buffer.from([eoj_list.length]).toString('hex') + eoj_list.join('');
    const buf = packetComposer.compose({
      seoj: seoj,
      deoj: '0EF001',
      esv: 'INF',
      properties: [
        {
          epc: 'D5',
          edt: edt,
        },
      ],
    });
    return buf;
  }

  /* ------------------------------------------------------------------
   * stop()
   * デバイスを停止する
   * - すでに停止していた場合、何もせずに resolve する。
   * ---------------------------------------------------------------- */
  async stop(): Promise<void> {
    this._console.printSysInitMsg('Stopping the device...');
    if (this.instance_announce_timer) {
      clearInterval(this.instance_announce_timer);
    }
    if (this.property_announce_timer) {
      clearInterval(this.property_announce_timer);
    }
    if (this._udp) {
      this.emit('powerstatuschanged', {
        powerStatus: false,
      });
      this._power_status = false;
      this._console.printSysInitRes('OK');
    } else {
      this._udp = null;
      this.emit('powerstatuschanged', {
        powerStatus: false,
      });
      this._power_status = false;
      this._console.printSysInitRes('OK');
    }
  }

  /* ------------------------------------------------------------------
   * getPowerStatus()
   * デバイスの電源状態を取得する
   * ---------------------------------------------------------------- */
  getPowerStatus(): any {
    //return this._udp ? true : false;
    return this._power_status;
  }

  /* ------------------------------------------------------------------
   * sendPacket(address, packet)
   * パケットを送信
   *
   * 引数
   *   - address:
   *       送信先 IP アドレス
   *   - packet:
   *       EL パケットを表すハッシュオブジェクト
   *
   * - packet       | Object  | required |
   *   - tid        | integer | optional | 指定がなけれは自動採番
   *   - seoj       | string  | required | 16進数文字列 (例: "013001")
   *   - deoj       | string  | required | 16進数文字列 (例: "05FF01")
   *   - esv        | string  | required | ESV キーワード (例: "GET_RES") または 16進数文字列
   *   - properties | array   | required | object のリスト
   *     - epc      | string  | required | EPCの16進数文字列 (例: "80")
   *     - edt      | string  | optional | EDTの16進数文字列
   *
   * 戻値
   *   Promise オブジェクトを返す
   *   reject() には以下のハッシュオブジェクトを引き渡す:
   *
   *   {
   *     result: 0, // 0: 成功, 1: パラメーターエラー
   *     message: 'エラーメッセージ', // 成功時には null
   *     hex: "1081000205FF010EF0006201D600", // 送信パケットの16進数文字列,
   *     data: {} // 送信パケットをパース下結果
   *   }
   *
   *   パラメーターエラーの場合は、reject() ではなく resolve() を呼び出す
   *   reject() を呼び出すのは、UDP パケット送信エラーの場合のみ
   * ---------------------------------------------------------------- */
  async sendPacket(address: any, packet: any): Promise<any> {
    // 本デバイスがパワーオフの状態ならエラー
    if (this._power_status === false) {
      throw new Error('The power status is off. Turn on this emulator.');
    }

    const buf = packetComposer.compose(packet);
    if (!buf) {
      const error = packetComposer.error;
      let message = 'Failed to create a Packet Buffer object: ';
      if (error) {
        message += error.message;
      }
      return {
        result: 1,
        message: message,
      };
    }
    return this.send(address, buf);
  }

  /* ------------------------------------------------------------------
   * send(address, buf)
   * パケットを送信する
   *
   * EL パケットを表す Buffer オブジェクトを引数に取るローレベルメソッド。
   * ハイレベルメソッドは sendPacket() メソッドを使うこと。
   * ---------------------------------------------------------------- */
  async send(address: any, buf: any): Promise<any> {
    // 本デバイスがパワーオフの状態ならエラー
    if (this._power_status === false) {
      throw new Error('The power status is off. Turn on this emulator.');
    }

    // EL パケットをパース
    let parsed = this._parser.parse(buf);
    if (parsed['result'] !== 0) {
      throw new Error(parsed.message);
    }

    // SEOJ から規格 Version 情報が判明すれば、再度、パースし直す
    const seoj = parsed['data']['data']['seoj']['hex'];
    if (!/^0EF0/.test(seoj)) {
      let release = '';
      this._current_eoj_list.forEach((info: any) => {
        if (info['eoj'] === seoj) {
          if (info['release']) {
            release = info['release'];
          }
        }
      });
      if (release) {
        parsed = this._parser.parse(buf, release);
      }
    }

    // コンソールに出力
    if (this._conf['console-packet'] === true) {
      if (parsed['result'] === 0) {
        this._console.printPacketTx(address, parsed['data']['hex']);
      } else {
        this._console.printPacketTx(address, parsed['hex']);
      }
    }

    // EL パケットをログに出力
    if (this._packet_logger) {
      this._packet_logger.tx(address, parsed);
    }

    // EL パケット送信イベントを発火
    this.emit('sent', address, parsed);

    try {
      await this._packet_sender.send(address, buf);
    } catch (error) {
      // パケットエラーログに出力
      if (this._packet_logger) {
        const dest_addr =
          address || this._ip_address_utils.getMulticastAddress();
        this._packet_logger.txError(dest_addr, {
          message: (error as Error).message,
          hex: buf.toString('hex').toUpperCase(),
        });
      }
      throw error;
    }
    return parsed;
  }

  _sendSnaForOpcOverflow(address: any, parsed: any): any {
    const d = parsed['data']['data'];
    const esv = d['esv']['hex'];
    const esv1 = esv.substr(0, 1);
    const esv2 = esv.substr(1, 1);
    if (esv1 !== '6' || esv !== '74') {
      return;
    }
    const packet: any = {
      tid: parseInt(d['tid'], 16),
      seoj: d['deoj']['hex'], // DEOJ と SDOJ をひっくり返す
      deoj: d['seoj']['hex'],
      esv: '5' + esv2,
      properties: [],
    };

    const props = d['properties'];
    for (let i = 0, len = props.length; i < len; i++) {
      const prop = props[i];
      packet['properties'].push({
        epc: prop['epc']['hex'],
        edt: props['edt']['hex'],
      });
    }

    const buf = packetComposer.compose(packet);
    if (!buf) {
      return;
    }
    this.send(address, buf).catch(() => {
      // Do nothing
    });
  }

  /* ------------------------------------------------------------------
   * getEpcValues(eoj, props)
   * EPC の値 (EDT) を読みだす (ダッシュボード向け)
   *
   * 引数:
   * - eoj      | String  | required |
   *     - エミュレート中のインスタンスの EOJ (例: "013001")
   * - props    | Array   | required |
   *     - 例: [{"epc": "8A", "edt":"any"}, ...]
   *     - epc の値しか見ないので edt の any の部分は何が入っていても構わない
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   * {
   *    result       : 読み出しに失敗した EDT の数 (つまりすべて成功すれば 0),
   *    message      : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
   *    elProperties : プロパティ情報のリスト
   *  }
   *
   * reject() は本メソッドに渡されたパラメータに不備があった場合のみ呼び出される。
   * ---------------------------------------------------------------- */
  async getEpcValues(eoj: any, props: any): Promise<any> {
    const devobj = this._device_objects[eoj];
    if (!devobj) {
      throw new Error('The specified EPC is not being emulated.');
    }
    const release = devobj.getStandardVersion();
    const eoj_desc = this._mDeviceDescription.getEoj(eoj, null, release);
    const pdesc = eoj_desc['elProperties'];

    const res = await devobj.getEpcValues(props, true);
    const vals = res['vals'];
    const prop_list: any = [];
    Object.keys(vals)
      .sort()
      .forEach(epc => {
        const hex = vals[epc] || null;
        let edt_data: any = null;
        if (hex) {
          edt_data = {hex: hex};
          const pdata = pdesc[epc]['data'];
          const edt_buf = this._convHexToBuffer(hex);
          const pv = this._parser.parsePropertyValue(
            pdata,
            edt_buf,
            epc,
            eoj,
            release,
          );
          edt_data['data'] = pv;
        }
        prop_list.push({
          epc: epc,
          propertyName: pdesc[epc] ? pdesc[epc]['propertyName'] : null,
          edt: edt_data,
          map: devobj.getAccessRule(epc),
        });
      });
    res['elProperties'] = prop_list;
    delete res['vals'];
    return structuredClone(res);
  }

  _convHexToBuffer(hex: any): any {
    if (
      !hex ||
      typeof hex !== 'string' ||
      !/^[a-fA-F0-9]+$/.test(hex) ||
      hex.length % 2 !== 0
    ) {
      return null;
    }
    const blen = hex.length / 2;
    const buf = Buffer.alloc(blen);
    for (let i = 0; i < blen; i++) {
      const h = hex.substr(i * 2, 2);
      const dec = parseInt(h, 16);
      buf.writeUInt8(dec, i);
    }
    return buf;
  }

  /* ------------------------------------------------------------------
   * setEpcValues(eoj, props)
   * EPC の値 (EDT) を書き込む (ダッシュボード向け)
   *
   * 引数:
   * - eoj      | String  | required |
   *     - エミュレート中のインスタンスの EOJ (例: "013001")
   * - props    | Array   | required |
   *     - 例: [{"epc": "8A", "edt":"any"}, ...]
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   * {
   *    result  : 保存に失敗した EDT の数 (つまりすべて成功すれば 0),
   *    message : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
   *    vals    : 保存に成功した EDT は null が、失敗した EDT は引数の vals と同じ (SNA を想定),
   *    changed : 変更があった ECP と EDT のハッシュオブジェクト (状態変化INFの情報源として使われる)
   *  }
   *
   * reject() は本メソッドに渡されたパラメータに不備があった場合のみ呼び出される。
   * ---------------------------------------------------------------- */
  async setEpcValues(eoj: any, props: any): Promise<any> {
    const devobj = this._device_objects[eoj];
    if (!devobj) {
      throw new Error('The specified EPC is not being emulated.');
    }
    return devobj.setEpcValues(props, true);
  }

  /* #######################################################################
   * 以下、コントローラーの場合にのみ有効なメソッド
   * ##################################################################### */

  // EL パケットを受信したときのコントローラーとしての処理
  //   リモートデバイス発見処理
  _receivePacketForController(parsed: any, device_info: any): any {
    if (!this._is_controller) {
      return;
    }

    const address = device_info['address'];
    const data = parsed['data']['data'];
    const seoj = data['seoj']['hex'];
    // const deoj = data['deoj']['hex'];
    const esv = data['esv']['hex'];
    const props = data['properties'];

    // リクエストコールバックがあれば実行して終了
    const tid = parsed['data']['data']['tid']['hex'];
    if (this._request_callback_map[tid]) {
      const cb = this._request_callback_map[tid];
      cb(parsed);
      delete this._request_callback_map[tid];
      return;
    }

    const epcs: any = {};
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const epc_hex = p['epc']['hex'];
      const edt = p['edt'];
      if (edt) {
        epcs[epc_hex] = edt;
      }
    }

    // ESV が 状変アナウンス (ESV: 0x73) の場合
    if (esv === '73') {
      // 既知のリモートデバイスですでに発見処理が終わっている場合
      if (this._remote_devices[address]) {
        // 発見済みリモートデバイスの EDT を更新する
        const rdev = this._remote_devices[address];
        for (let i = 0; i < rdev['eojList'].length; i++) {
          const eoj_data = rdev['eojList'][i];
          if (eoj_data['eoj'] === seoj) {
            eoj_data['elProperties'].forEach((p: any) => {
              const epc = p['epc'];
              if (epcs[epc]) {
                p['edt'] = epcs[epc];
              }
            });
            break;
          }
        }
      }
    }

    if (address in this._remote_devices) {
      // 登録済みのリモートデバイスならEOJをチェック
      // - 同じIPアドレスなのに未知のEOJからのパケットなら、IPアドレスが
      //   別のデバイスに入れ替わったと判定する
      const rdev = this._remote_devices[address];
      if (rdev) {
        let is_known = false;
        for (let i = 0; i < rdev['eojList'].length; i++) {
          const eoj_data = rdev['eojList'][i];
          if (eoj_data['eoj'] === seoj) {
            is_known = true;
            break;
          }
        }
        if (is_known) {
          // 既知のデバイスなので、ここで終了
          return;
        } else {
          this.emit('disappeared', {
            id: rdev['id'],
            address: address,
          });
          delete this._remote_devices[address];
        }
      } else {
        // null ならリモートデバイス調査中なので、ここで終了
        return;
      }
    }

    // 以降の処理は、未知のリモートデバイスの調査処理

    // ESV が GetRes (0x72) かつ EPC が自ノードインスタンスリストS (0xD6)の場合
    // ESV が INF (0x73) かつ EPC がインスタンスリスト通知 (0xD5)の場合
    if ((esv === '72' && epcs['D6']) || (esv === '73' && epcs['D5'])) {
      const edt = epcs['D6'] || epcs['D5'];
      if (!edt) {
        return;
      }

      if (!edt['data']) {
        return;
      }
      const edt_data = edt['data'];
      if (
        !edt_data['object'] ||
        !Array.isArray(edt_data['object']) ||
        edt_data['object'].length < 2
      ) {
        return;
      }
      if (
        edt_data['object'][1]['name'] !== 'instanceList' ||
        !edt_data['object'][1]['array']
      ) {
        return;
      }

      // 現在、リモートデバイス調査中ということを表すために、あえて null をセットしておく。
      this._remote_devices[address] = null;

      const class_names: any = {};
      const is_known_classes: any = {};
      const eoj_list = [seoj];
      edt_data['object'][1]['array'].forEach((o: any) => {
        const eoj_hex = o['raw'];
        if (o['className']) {
          class_names[eoj_hex] = o['className'];
          is_known_classes[eoj_hex] = true;
        } else {
          class_names[eoj_hex] = {
            ja: '不明',
            en: 'Unknown',
          };
          is_known_classes[eoj_hex] = false;
        }
        if (eoj_list.indexOf(eoj_hex) < 0) {
          eoj_list.push(eoj_hex);
        }
      });
      if (data['seoj']['className']) {
        class_names[seoj] = data['seoj']['className'];
        is_known_classes[seoj] = true;
      } else {
        class_names[seoj] = {
          ja: '不明',
          en: 'Unknown',
        };
        is_known_classes[seoj] = false;
      }

      const eojs: any = {};
      eoj_list.forEach(eoj => {
        eojs[eoj] = {
          eoj: eoj,
          className: class_names[eoj],
          manufacturer: null,
          release: '',
          elProperties: null,
          isKnownClass: is_known_classes[eoj],
        };
      });

      this._investigateRemoteDevice(address, eoj_list, eojs).catch(error => {
        if (this._remote_devices[address] === null) {
          delete this._remote_devices[address];
        }
        console.error(error);
      });
    } else {
      // Node profile に対して自ノードインスタンスリストS (EPC: 0xD6) Get を送信
      const packet = {
        seoj: this._controller_eoj,
        deoj: '0EF000',
        esv: '62',
        properties: [
          {
            epc: 'D6',
            edt: null,
          },
        ],
      };

      this.sendPacket(address, packet).catch(error => {
        console.error(
          'Failed to send a multicast packet for getting the Self-node Instance List S from node profiles.',
        );
        console.error(error);
      });
    }
  }

  // 未知のリモートデバイスの情報を取得して登録する
  async _investigateRemoteDevice(
    address: any,
    eoj_list: any,
    eojs: any,
  ): Promise<void> {
    const rdev: any = {
      address: address,
      id: null,
      eojList: [],
    };

    // 識別番号 (EPC: 0x83) を取得
    rdev['id'] = await this._getRemoteDeviceId(address);

    // EOJ ごとのプロパティマップを取得
    const maps = await this._getRemoteDevicePropertyMaps(address, eoj_list);
    for (const eoj of Object.keys(maps)) {
      eojs[eoj]['elProperties'] = maps[eoj];
    }

    // EOJ ごとの規格 Version 情報 (リリース番号) を取得
    const rels = await this._getRemoteDeviceReleases(address, eoj_list);
    for (const eoj of Object.keys(rels)) {
      eojs[eoj]['release'] = rels[eoj];
    }

    // EOJ ごとのメーカーコードを取得
    const manus = await this._getRemoteDeviceManufacturerCodes(
      address,
      eoj_list,
    );
    for (const eoj of Object.keys(manus)) {
      eojs[eoj]['manufacturer'] = manus[eoj];
    }

    for (const eoj of Object.keys(eojs)) {
      rdev['eojList'].push(eojs[eoj]);
    }

    this._remote_devices[address] = rdev;
    this.emit('discovered', structuredClone(rdev));
  }

  _isSameEojList(r1: any, r2: any): any {
    const eojs2: any = {};
    r2['eojList'].forEach((e: any) => {
      eojs2[e['eoj']] = true;
    });
    let is_same = true;
    r1['eojList'].forEach((e: any) => {
      const eoj = e['eoj'];
      if (eojs2[eoj]) {
        delete eojs2[eoj];
      } else {
        is_same = false;
      }
    });
    if (Object.keys(eojs2).length > 0) {
      is_same = false;
    }
    return is_same;
  }

  async _getRemoteDeviceId(address: any): Promise<any> {
    const packet = {
      seoj: this._controller_eoj,
      deoj: '0EF001',
      esv: '62',
      properties: [
        {
          epc: '83',
          edt: null,
        },
      ],
    };
    const res = await this._request(address, packet);
    if (res['result'] !== 0) {
      throw new Error(
        'Failed to get the Identification number (EPC: 0x83) from ' +
          address +
          ': ' +
          res['message'],
      );
    }
    const prop = res['data']['data']['properties'][0];
    if (!prop || prop['epc']['hex'] !== '83' || !prop['edt']['hex']) {
      throw new Error(
        'Failed to get the Identification number (EPC: 0x83) from ' + address,
      );
    }
    await sleep(this._request_interval_msec);
    return prop['edt']['hex'];
  }

  async _getRemoteDevicePropertyMaps(
    address: any,
    eoj_list: any,
  ): Promise<any> {
    const maps: any = {};
    for (const eoj of eoj_list) {
      maps[eoj] = await this._getRemoteDeviceEojPropertyMaps(address, eoj);
    }
    return maps;
  }

  async _getRemoteDeviceEojPropertyMaps(address: any, eoj: any): Promise<any> {
    // Get, Set, Inf プロパティマップの EPC
    const epc_map: Record<string, string> = {
      get: '9F',
      set: '9E',
      inf: '9D',
    };
    const map: Record<string, any[]> = {
      get: [],
      set: [],
      inf: [],
    };
    for (const [key, epc] of Object.entries(epc_map)) {
      const packet = {
        seoj: this._controller_eoj,
        deoj: eoj,
        esv: '62',
        properties: [
          {
            epc: epc,
            edt: null,
          },
        ],
      };
      try {
        const parsed = await this._request(address, packet);
        const prop = parsed['data']['data']['properties'][0];
        if (
          prop &&
          prop['epc']['hex'] === epc &&
          prop['edt']['data'] &&
          prop['edt']['data']['propertyList']
        ) {
          map[key] = [...prop['edt']['data']['propertyList']];
        }
      } catch (error) {
        console.error(
          new Error(
            'Failed to fetch the ' +
              key +
              ' property map from the EOJ ' +
              eoj +
              ' of ' +
              address +
              ': ' +
              (error as Error).message,
          ),
        );
      }
      await sleep(this._request_interval_msec);
    }

    // map の get, set, inf をマージ
    const props: any = {};
    for (const k in map) {
      map[k]?.forEach((d: any) => {
        const epc = d['epc'];
        if (!props[epc]) {
          props[epc] = {
            epc: epc,
            propertyName: d['propertyName'],
            map: {
              get: false,
              set: false,
              inf: false,
            },
            edt: null,
          };
        }
        props[epc]['map'][k] = true;
      });
    }
    return Object.keys(props)
      .sort()
      .map(epc => props[epc]);
  }

  async _getRemoteDeviceReleases(address: any, eoj_list: any): Promise<any> {
    const rels: any = {};
    for (const eoj of eoj_list) {
      // ノードプロファイルの場合は除外
      if (/^0EF0/.test(eoj)) {
        continue;
      }

      const epc = '82';
      const packet = {
        seoj: this._controller_eoj,
        deoj: eoj,
        esv: '62',
        properties: [
          {
            epc: epc,
            edt: null,
          },
        ],
      };
      try {
        const parsed = await this._request(address, packet);
        const prop = parsed['data']['data']['properties'][0];
        if (
          prop &&
          prop['epc']['hex'] === epc &&
          prop['edt']['data'] &&
          prop['edt']['data']['release']
        ) {
          rels[eoj] = prop['edt']['data']['release'];
        }
      } catch (error) {
        console.error(
          new Error(
            'Failed to fetch the standard version information from the EOJ ' +
              eoj +
              ' of ' +
              address +
              ': ' +
              (error as Error).message,
          ),
        );
      }
      await sleep(this._request_interval_msec);
    }
    return rels;
  }

  async _getRemoteDeviceManufacturerCodes(
    address: any,
    eoj_list: any,
  ): Promise<any> {
    const manus: any = {};
    for (const eoj of eoj_list) {
      const epc = '8A';
      const packet = {
        seoj: this._controller_eoj,
        deoj: eoj,
        esv: '62',
        properties: [
          {
            epc: epc,
            edt: null,
          },
        ],
      };
      try {
        const parsed = await this._request(address, packet);
        const prop = parsed['data']['data']['properties'][0];
        if (
          prop &&
          prop['epc']['hex'] === epc &&
          prop['edt']['data'] &&
          prop['edt']['data']['manufacturerName']
        ) {
          manus[eoj] = {
            code: prop['edt']['hex'],
            name: prop['edt']['data']['manufacturerName'],
          };
        } else {
          manus[eoj] = {
            code: prop['edt']['hex'],
            name: '',
          };
        }
      } catch (error) {
        console.error(
          new Error(
            'Failed to fetch the manufacturer code from the EOJ ' +
              eoj +
              ' of ' +
              address +
              ': ' +
              (error as Error).message,
          ),
        );
      }
      await sleep(this._request_interval_msec);
    }
    return manus;
  }

  // リクエストを送信してレスポンスを待つ
  // - タイムアウトしたら最大 this._request_retry_limit 回まで再送する
  async _request(address: any, packet: any, release?: any): Promise<any> {
    let last_error: any = null;
    for (let retry = 0; retry <= this._request_retry_limit; retry++) {
      let sent_parsed;
      try {
        sent_parsed = await this.sendPacket(address, packet);
      } catch (error) {
        last_error = error;
        continue;
      }
      if (sent_parsed['result'] !== 0) {
        throw new Error(sent_parsed['message']);
      }
      const tid = sent_parsed['data']['data']['tid']['hex'];
      if (release) {
        this._request_release_map[tid] = release;
      }
      const parsed = await this._waitForResponse(tid);
      if (parsed) {
        return parsed;
      }
      last_error = new Error('TIMEOUT: ' + address);
    }
    throw last_error;
  }

  // 指定の TID のレスポンスを待つ
  // - タイムアウトしたら null を返す
  _waitForResponse(tid: any): Promise<any> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        delete this._request_callback_map[tid];
        resolve(null);
      }, this._request_timeout_msec);
      this._request_callback_map[tid] = (parsed: any) => {
        clearTimeout(timer);
        resolve(parsed);
      };
    });
  }

  /* ------------------------------------------------------------------
   * getRemoteDeviceList()
   * 現時点で認識しているリモートデバイス情報のリストを返す
   *
   * 引数:
   *   なし
   *
   * 戻値:
   *   以下のプロパティを含んだハッシュオブジェクト
   *
   *   result           | Integer | 0 なら成功、1 なら失敗
   *   code             | Integer | HTTP ステータスコード
   *                    |         | - 200 : 成功
   *                    |         | - 403 : コントローラーでない
   *   message          | String  | 失敗の場合に理由がセットされる。成功時は null。
   *   remoteDeviceList | Array   | リモートデバイスの情報を格納した配列
   *                    |         | 失敗時は null がセットされる
   *
   * リモートデバイスの情報は以下のハッシュオブジェクト:
   *  {
   *    "address": "192.168.11.4", // IP アドレス
   *    "id": "FE00001BF0761C95FB1800000000000000", // 識別番号
   *    "eojList: [
   *      {
   *        "eoj": "0EF001",
   *        "className": {
   *          "ja": "ノードプロファイル",
   *          "en": "Node Profile"
   *        },
   *        "manufacturer": {
   *          "code": "00001B",
   *          "name": {
   *            "ja": "東芝ライテック株式会社",
   *            "en": "Toshiba Lighting & Technology Corporation"
   *        },
   *        "release": "J",
   *        "elProperties": [
   *          {
   *            "epc": "80",
   *            "propertyName": {
   *              "ja": "動作状態",
   *              "en": "Operation status"
   *            },
   *            "map": {
   *              "get": true,
   *              "set": false,
   *              "inf": true
   *            },
   *            edt: null
   *          },
   *          ...
   *        ]
   *      },
   *      ...
   *    ]
   *  }
   * ---------------------------------------------------------------- */
  getRemoteDeviceList(): any {
    if (!this._is_controller) {
      return {
        result: 1,
        code: 403,
        message:
          'This method is available only when this emulator is set as a EL Controller.',
        remoteDeviceList: null,
      };
    }
    const list: any = [];
    Object.keys(this._remote_devices).forEach(address => {
      const rdev = this._remote_devices[address];
      if (rdev) {
        list.push(rdev);
      }
    });
    return {
      result: 0,
      code: 200,
      message: null,
      remoteDeviceList: structuredClone(list),
    };
  }

  /* ------------------------------------------------------------------
   * deleteRemoteDeviceList()
   * 現時点で認識しているリモートデバイス情報のリストをクリアする
   *
   * 引数:
   *   なし
   *
   * 戻値:
   *   以下のプロパティを含んだハッシュオブジェクト
   *
   *   result           | Integer | 0 なら成功、1 なら失敗
   *   code             | Integer | HTTP ステータスコード
   *                    |         | - 200 : 成功
   *                    |         | - 403 : コントローラーでない
   *   message          | String  | 失敗の場合に理由がセットされる。成功時は null。
   * ---------------------------------------------------------------- */
  deleteRemoteDeviceList(): any {
    if (!this._is_controller) {
      return {
        result: 1,
        code: 403,
        message:
          'This method is available only when this emulator is set as a EL Controller.',
        remoteDeviceList: null,
      };
    }

    Object.keys(this._remote_devices).forEach(addr => {
      this.emit('disappeared', {
        address: addr,
        id: this._remote_devices[addr]['id'],
      });
    });

    this._remote_devices = {};

    return {
      result: 0,
      code: 200,
      message: null,
    };
  }

  /* ------------------------------------------------------------------
   * sendDiscoveryPacket()
   * 機器発見パケットを送信する
   *
   * 引数:
   *   なし
   *
   * 戻値:
   *   Promise オブジェクト
   *
   *   resolve() には以下のプロパティを含んだハッシュオブジェクトが引き渡される
   *
   *   result  | Integer | 0 なら成功、1 なら失敗
   *   code    | Integer | HTTP ステータスコード (403 or 500)
   *           |         | - 200 : 成功
   *           |         | - 403 : コントローラーでない
   *           |         | - 500 : UDP パケット送信失敗
   *   message | String  | 失敗の場合に理由がセットされる。成功時は null。
   *
   *   reject() が呼び出されることはない。
   * ---------------------------------------------------------------- */
  async sendDiscoveryPacket(): Promise<any> {
    if (!this._is_controller) {
      return {
        result: 1,
        code: 403,
        message:
          'This method is available only when this emulator is set as a EL Controller.',
      };
    }

    // Node profile に対して
    // 自ノードインスタンスリストS (EPC: 0xD6) Get を送信
    const packet = {
      seoj: this._controller_eoj,
      deoj: '0EF000',
      esv: '62',
      properties: [
        {
          epc: 'D6',
          edt: null,
        },
      ],
    };

    try {
      await this.sendPacket(null, packet);
    } catch (error) {
      return {
        result: 1,
        code: 500,
        message: (error as Error).message,
      };
    }
    await sleep(1000);
    return {
      result: 0,
      code: 200,
      message: null,
    };
  }

  /* ------------------------------------------------------------------
   * getRemoteDeviceEpcData(address, eoj, epc)
   * リモートデバイスの EPC データ (EDT) を取得する
   *
   * 引数:
   * - address  | String  | required |
   *     - リモートデバイスの IP アドレス (例: "192.168.11.4")
   * - eoj      | String  | required |
   *     - リモートデバイスの EOJ (例: "013001")
   * - epc      | String   | required |
   *     - リモートデバイスの EPC (例: "80")
   *
   * 戻値:
   *   Promise オブジェクト
   *
   *   resolve() には以下のプロパティを含んだハッシュオブジェクトが引き渡される
   *
   *   result   | Integer | 0 なら成功、1 なら失敗
   *   code     | Integer | HTTP ステータスコード (403 or 500)
   *            |         | - 200 : 成功
   *            |         | - 400 : パラメーターエラー
   *            |         | - 403 : コントローラーでない
   *            |         | - 500 : UDP パケット送信失敗
   *   message  | String  | 失敗の場合に理由がセットされる。成功時は null。
   *   elProperty | Object  | パケットの解析結果
   *
   *   reject() が呼び出されることはない。
   * ---------------------------------------------------------------- */
  async getRemoteDeviceEpcData(
    address: any,
    eoj: any,
    epc: any,
  ): Promise<any> {
    if (!this._is_controller) {
      return {
        result: 1,
        code: 403,
        message:
          'This method is available only when this emulator is set as a EL Controller.',
      };
    }

    if (!address || typeof address !== 'string') {
      return {
        result: 1,
        code: 400,
        message: 'The `address` is invalid.',
      };
    }

    if (!this._remote_devices[address]) {
      return {
        result: 1,
        code: 400,
        message: 'The specified `address` is unknown.',
      };
    }

    if (!eoj || typeof eoj !== 'string' || !/^[0-9A-F]{6}$/.test(eoj)) {
      return {
        result: 1,
        code: 400,
        message: 'The `eoj` is invalid.',
      };
    }

    if (!epc || typeof epc !== 'string' || !/^[0-9A-F]{2}$/.test(epc)) {
      return {
        result: 1,
        code: 400,
        message: 'The `epc` is invalid.',
      };
    }

    // リモートデバイスの規格 Version 情報を特定
    let release = '';
    this._remote_devices[address]['eojList'].forEach((e: any) => {
      if (e['eoj'] === eoj) {
        release = e['release'];
      }
    });

    // リクエストパケット
    const packet = {
      seoj: this._controller_eoj,
      deoj: eoj,
      esv: '62',
      properties: [
        {
          epc: epc,
          edt: null,
        },
      ],
    };

    const parsed = await this._request(address, packet, release);
    if (parsed['result'] !== 0) {
      return {
        result: 1,
        code: 400,
        message: parsed['message'],
      };
    }
    const d = parsed['data']['data'];
    if (d['esv']['hex'] !== '72') {
      return {
        result: 1,
        code: 400,
        message:
          'The ESV of the response is not 0x72 (GET_RES): 0x' + d['esv']['hex'],
      };
    }
    const prop = d['properties'].find((p: any) => p['epc']['hex'] === epc);
    if (!prop) {
      return {
        result: 1,
        code: 400,
        message: 'The EPC data was not found in the response.',
      };
    }
    const eoj_data = this._remote_devices[address]['eojList'].find(
      (e: any) => e['eoj'] === eoj,
    );
    if (eoj_data) {
      for (const p of eoj_data['elProperties']) {
        if (p['epc'] === epc) {
          p['edt'] = structuredClone(prop['edt']);
        }
      }
    }
    return {
      result: 0,
      code: 200,
      message: null,
      elProperty: prop,
    };
  }

  /* ------------------------------------------------------------------
   * setRemoteDeviceEpcData(address, eoj, epc, edt)
   * リモートデバイスの EPC データ (EDT) をセットする
   * 実際には SetC を送信して Set_Res を受けてから、Get を送信して Get_Res の結果を返す
   *
   * 引数:
   * - address  | String  | required |
   *     - リモートデバイスの IP アドレス (例: "192.168.11.4")
   * - eoj      | String  | required |
   *     - リモートデバイスの EOJ (例: "013001")
   * - epc      | String   | required |
   *     - リモートデバイスの EPC (例: "80")
   * - edt      | String   | required |
   *     - セットしたい EDT の 16 進数文字列 (例: "41")
   *
   * 戻値:
   *   Promise オブジェクト
   *
   *   resolve() には以下のプロパティを含んだハッシュオブジェクトが引き渡される
   *
   *   result   | Integer | 0 なら成功、1 なら失敗
   *   code     | Integer | HTTP ステータスコード (403 or 500)
   *            |         | - 200 : 成功
   *            |         | - 400 : パラメーターエラー
   *            |         | - 403 : コントローラーでない
   *            |         | - 500 : UDP パケット送信失敗
   *   message  | String  | 失敗の場合に理由がセットされる。成功時は null。
   *   property | Object  | パケットの解析結果
   *
   *   reject() が呼び出されることはない。
   * ---------------------------------------------------------------- */
  async setRemoteDeviceEpcData(
    address: any,
    eoj: any,
    epc: any,
    edt: any,
  ): Promise<any> {
    if (!this._is_controller) {
      return {
        result: 1,
        code: 403,
        message:
          'This method is available only when this emulator is set as a EL Controller.',
      };
    }

    if (!address || typeof address !== 'string') {
      return {
        result: 1,
        code: 400,
        message: 'The `address` is invalid.',
      };
    }

    if (!this._remote_devices[address]) {
      return {
        result: 1,
        code: 400,
        message: 'The specified `address` is unknown.',
      };
    }

    if (!eoj || typeof eoj !== 'string' || !/^[0-9A-F]{6}$/.test(eoj)) {
      return {
        result: 1,
        code: 400,
        message: 'The `eoj` is invalid.',
      };
    }

    if (!epc || typeof epc !== 'string' || !/^[0-9A-F]{2}$/.test(epc)) {
      return {
        result: 1,
        code: 400,
        message: 'The `epc` is invalid.',
      };
    }

    if (
      !edt ||
      typeof edt !== 'string' ||
      !/^[0-9A-F]+$/.test(edt) ||
      edt.length % 2 !== 0
    ) {
      return {
        result: 1,
        code: 400,
        message: 'The `edt` is invalid.',
      };
    }

    // リクエストパケット
    const packet = {
      seoj: this._controller_eoj,
      deoj: eoj,
      esv: '61',
      properties: [
        {
          epc: epc,
          edt: edt,
        },
      ],
    };

    const parsed = await this._request(address, packet);
    if (parsed['result'] !== 0) {
      return {
        result: 1,
        code: 400,
        message: parsed['message'],
      };
    }
    const d = parsed['data']['data'];
    const esv = d['esv']['hex'];
    if (esv !== '71') {
      return {
        result: 1,
        code: 400,
        message:
          'The ESV of the response was not 0x71 (SET_RES): 0x' + d['esv']['hex'],
      };
    }
    await sleep(300);
    return this.getRemoteDeviceEpcData(address, eoj, epc);
  }
}

export default Device;
