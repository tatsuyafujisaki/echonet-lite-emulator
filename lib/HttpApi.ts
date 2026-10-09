/* ------------------------------------------------------------------
 * REST API のフロントエンド
 *
 * ダッシュボードからの REST リクエストを受けて適切な処理を行う
 * ---------------------------------------------------------------- */

class HttpApi {
  _conf: any;
  _device: any;
  _device_description: any;
  _manufacturer_table: any;
  _uconf: any;
  /* ------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */
  constructor(
    conf: any,
    device: any,
    uconf: any,
    device_description: any,
    manufacturer_table: any,
  ) {
    this._conf = structuredClone(conf);
    this._device = device;
    this._uconf = uconf;
    this._device_description = device_description;
    this._manufacturer_table = manufacturer_table;
  }

  updateConf(conf: any) {
    this._conf = structuredClone(conf);
  }

  /* ------------------------------------------------------------------
   * REST リクエスト受信
   * request(req)
   *
   * - 引数:
   *   req = {
   *     reqId: 12,
   *     method: "POST",
   *     path: "/api/device/power",
   *     params: {}
   *   }
   *
   * - 戻値:
   *   Promise オブジェクト
   *
   * パラメータエラーなど、OS に起因しないエラーは reject() ではなく
   * resolve() を呼び出す。
   * ファイル書き込みエラーなど OS に起因するエラーは reject() を
   * 呼び出す。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   * {
   *   "reqId": 1,
   *   "method": "GET",
   *   "path": "/api/system/lang",
   *   "params": {},
   *   "result": 0,
   *   "code": 200,
   *   "data": { // 成功時のみ
   *     "lang": "en"
   *   },
   *   "message": "エラーメッセージ", // エラーの場合のみ,
   *   "errs": {"key": "error_message,...} // エラーの場合のみ (メソッドによる)
   * }
   * ---------------------------------------------------------------- */
  async request(req: any): Promise<any> {
    const k = req['path'] + ' ' + req['method'].toLowerCase();

    /* ------------------------------------------------
     * システム設定
     * /api/system
     * ---------------------------------------------- */
    if (k === '/api/system/lang get') {
      // システム言語取得
      return this._systemLangGet(req);
    } else if (k === '/api/system/lang put') {
      // システム言語設定
      return this._systemLangPut(req);
    } else if (k === '/api/system/configurations get') {
      // システム設定情報取得
      return this._systemConfigurationsget(req);
    } else if (k === '/api/system/configurations put') {
      // システム設定情報保存
      return this._systemConfigurationsPut(req);

      /* ------------------------------------------------
       * Device Description 管理
       * /api/deviceDescriptions
       * ---------------------------------------------- */
    } else if (k === '/api/deviceDescriptions get') {
      // Device Description デバイス一覧取得
      return this._deviceDescriptionsGet(req);
    } else if (/^\/api\/deviceDescriptions\/[0-9A-F]{4,6} get$/.test(k)) {
      // Device Description デバイス情報取得
      return this._deviceDescriptionsDeviceGet(req);
    } else if (
      /^\/api\/deviceDescriptions\/[0-9A-F]{4,6}\/[A-Z] get$/.test(k)
    ) {
      // Device Description デバイス情報取得
      return this._deviceDescriptionsDeviceGet(req);
    } else if (k === '/api/deviceDescriptions/releases get') {
      // 有効なリリースバージョンのリストを取得
      return this._deviceDescriptionsReleasesGet(req);

      /* ------------------------------------------------
       * メーカー
       * /api/manufacturers
       * ---------------------------------------------- */
    } else if (k === '/api/manufacturers get') {
      // メーカー情報一括取得
      return this._manufacturersGet(req);
    } else if (/^\/api\/manufacturers\/[0-9A-F]{6} get$/.test(k)) {
      // メーカー情報取得
      return this._manufacturersmanufacturerGet(req);

      /* ------------------------------------------------
       * デバイスリセット
       * /api/device
       * ---------------------------------------------- */
    } else if (k === '/api/device delete') {
      // デバイス初期化
      return this._deviceDelete(req);

      /* ------------------------------------------------
       * デバイス電源操作
       * /api/device/power
       * ---------------------------------------------- */
    } else if (k === '/api/device/power get') {
      // デバイス電源状態取得
      return this._devicePowerGet(req);
    } else if (k === '/api/device/power post') {
      // デバイス電源 ON
      return this._devicePowerPost(req);
    } else if (k === '/api/device/power delete') {
      // デバイス電源 Off
      return this._devicePowerDelete(req);

      /* ------------------------------------------------
       * デバイス EOJ 管理
       * /api/device/eojs
       * ---------------------------------------------- */
    } else if (k === '/api/device/eojs get') {
      // デバイス EOJ 一覧取得
      return this._deviceEojsGet(req);
    } else if (k === '/api/device/eojs put') {
      // デバイス EOJ 一括登録
      return this._deviceEojsPut(req);
    } else if (k === '/api/device/eojs post') {
      // デバイス EOJ 新規登録
      return this._deviceEojsPost(req);
    } else if (/^\/api\/device\/eojs\/[0-9A-F]{6} get$/.test(k)) {
      // デバイス EOJ 取得
      return this._deviceEojsEojGet(req);
    } else if (/^\/api\/device\/eojs\/[0-9A-F]{6} put$/.test(k)) {
      // デバイス EOJ 修正
      return this._deviceEojsEojPut(req);
    } else if (/^\/api\/device\/eojs\/[0-9A-F]{6} delete$/.test(k)) {
      // デバイス EOJ 削除
      return this._deviceEojsEojDelete(req);

      /* ------------------------------------------------
       * EPC 管理
       * /api/device/eojs/{eoj}/epcs
       * ---------------------------------------------- */
    } else if (/^\/api\/device\/eojs\/[0-9A-F]{6}\/epcs get$/.test(k)) {
      // デバイス EPC データ (EDT) 一括取得
      return this._deviceEpcsGet(req);
    } else if (/^\/api\/device\/eojs\/[0-9A-F]{6}\/epcs put$/.test(k)) {
      // デバイス EPC データ (EDT) 一括設定
      return this._deviceEpcsPut(req);
    } else if (
      /^\/api\/device\/eojs\/[0-9A-F]{6}\/epcs\/[0-9A-F]{2} get$/.test(k)
    ) {
      // デバイス EPC データ (EDT) 個別取得
      return this._deviceEpcsEpcGet(req);
    } else if (
      /^\/api\/device\/eojs\/[0-9A-F]{6}\/epcs\/[0-9A-F]{2} put$/.test(k)
    ) {
      // デバイス EPC データ (EDT) 個別設定
      return this._deviceEpcsEpcPut(req);

      /* ------------------------------------------------
       * EL パケット
       * /api/device/packet
       * ---------------------------------------------- */
    } else if (k === '/api/device/packet post') {
      // EL パケット送信
      return this._devicePacketPost(req);

      /* ------------------------------------------------
       * コントローラー
       * /api/controller
       * ---------------------------------------------- */
    } else if (k === '/api/controller/remoteDevices get') {
      // リモートデバイスの一覧を取得
      return this._controllerRemoteDevicesGet(req);
    } else if (k === '/api/controller/remoteDevices delete') {
      // リモートデバイスのクリア
      return this._controllerRemoteDevicesDelete(req);
    } else if (
      /^\/api\/controller\/remoteDevices\/[0-9A-Fa-f\.\:]+\/eojs\/[0-9A-F]{6}\/epcs\/[0-9A-F]{2} get/.test(
        k,
      )
    ) {
      // リモートデバイスの EPC データ (EDT) の個別取得
      return this._controllerRemoteDevicesEpcGet(req);
    } else if (
      /^\/api\/controller\/remoteDevices\/[0-9A-Fa-f\.\:]+\/eojs\/[0-9A-F]{6}\/epcs\/[0-9A-F]{2} put/.test(
        k,
      )
    ) {
      // リモートデバイスの EPC データ (EDT) の個別設定
      return this._controllerRemoteDevicesEpcPut(req);
    } else if (k === '/api/controller/discovery post') {
      // デバイス発見パケットを送信
      return this._controllerDiscoveryPost(req);

      /* ------------------------------------------------
       * その他
       * ---------------------------------------------- */
    } else {
      this._setReqToErrorRes(req, 1, 404, 'Unknown request method and path.');
      return req;
    }
  }

  _setReqToSuccessRes(req: any, data?: any) {
    req['result'] = 0;
    req['code'] = 200;
    if (data) {
      req['data'] = data;
    }
  }

  _setReqToErrorRes(req: any, result: any, code: any, message: any) {
    req['result'] = result;
    req['code'] = code;
    req['message'] = message;
  }

  _setReqTo400Res(req: any, message: any) {
    this._setReqToErrorRes(req, 1, 400, message);
    return req;
  }

  // ユーザー設定情報を保存して、その結果をレスポンスにセットする
  async _setUserConf(req: any, params: any): Promise<any> {
    const res = await this._uconf.set(params);
    // -------------------------------------------------------------
    // res:
    //   result | Interger | 値エラーの数 (すべて成功すれば 0),
    //   data   | Object   | 保存した設定値を格納したハッシュオブジェクト
    //                       エラーの場合は null がセットされる
    //   errs   | Object   | 不正な値のキーとエラーメッセージを格納したハッシュオブジェクト
    //                       すべて成功すれば null がセットされる
    // -------------------------------------------------------------
    Object.assign(req, res);
    if (res['result'] === 0) {
      req['code'] = 200;
    } else {
      req['code'] = 400;
      req['message'] = 'Parameter Error';
    }
    return req;
  }

  // システム言語取得
  async _systemLangGet(req: any): Promise<any> {
    this._setReqToSuccessRes(req, {
      lang: this._conf['lang'],
    });
    return req;
  }

  // システム言語設定
  async _systemLangPut(req: any): Promise<any> {
    const p = req['params'];
    return this._setUserConf(req, {lang: p['lang']});
  }

  // システム設定情報取得
  async _systemConfigurationsget(req: any): Promise<any> {
    const c = this._uconf.get();
    this._setReqToSuccessRes(req, c);
    return req;
  }

  // システム設定情報保存
  async _systemConfigurationsPut(req: any): Promise<any> {
    const p = req['params'];
    return this._setUserConf(req, p);
  }

  // Device Description デバイス一覧取得
  async _deviceDescriptionsGet(req: any): Promise<any> {
    const list = this._device_description.getDeviceList();
    this._setReqToSuccessRes(req, {
      deviceList: list,
    });
    return req;
  }

  // Device Description デバイス情報取得
  async _deviceDescriptionsDeviceGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[3];
    const release = path_part_list[4];
    const desc = this._device_description.getEoj(eoj, release);
    if (desc) {
      // elProperties は、内部的には EPC をキーとしたハッシュオブジェクトだが、
      // 戻値は、オリジナルの deviceDescription に合わせて Array にする
      // Array のほうがダッシュボードの JS で扱いやすいという理由もある
      const prop_list: any = [];
      Object.keys(desc['elProperties'])
        .sort()
        .forEach(epc_hex => {
          prop_list.push(desc['elProperties'][epc_hex]);
        });
      desc['elProperties'] = prop_list;

      this._setReqToSuccessRes(req, {
        device: desc,
      });
    } else {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The information for the specified EOJ was not found in the ECHONET Lite Device Description: ' +
          eoj,
      );
    }
    return req;
  }

  // 有効なリリースバージョンのリストを取得
  async _deviceDescriptionsReleasesGet(req: any): Promise<any> {
    const list = this._device_description.getReleaseList();
    this._setReqToSuccessRes(req, {
      releaseList: list,
    });
    return req;
  }

  // メーカー情報一括取得
  async _manufacturersGet(req: any): Promise<any> {
    const list = this._manufacturer_table.getList();
    this._setReqToSuccessRes(req, {
      manufacturerList: list,
    });
    return req;
  }

  // メーカー情報取得
  async _manufacturersmanufacturerGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const code = path_part_list[3];
    const name = this._manufacturer_table.get(code);
    if (name) {
      this._setReqToSuccessRes(req, {
        manufacturer: {
          code: code,
          name: name,
        },
      });
    } else {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The information for the specified manufacturer code was not found in the manufacturer table: ' +
          code,
      );
    }
    return req;
  }

  // デバイスリセット
  async _deviceDelete(req: any): Promise<any> {
    await this._device.reset();
    this._setReqToSuccessRes(req);
    return req;
  }

  // デバイス電源状態取得
  async _devicePowerGet(req: any): Promise<any> {
    this._setReqToSuccessRes(req, {
      powerStatus: this._device.getPowerStatus(),
    });
    return req;
  }

  // デバイス電源 ON
  async _devicePowerPost(req: any): Promise<any> {
    await this._device.start();
    this._setReqToSuccessRes(req, {
      powerStatus: this._device.getPowerStatus(),
    });
    return req;
  }

  // デバイス電源 Off
  async _devicePowerDelete(req: any): Promise<any> {
    await this._device.stop();
    this._setReqToSuccessRes(req, {
      powerStatus: this._device.getPowerStatus(),
    });
    return req;
  }

  // デバイス EOJ 一覧取得
  async _deviceEojsGet(req: any): Promise<any> {
    this._setReqToSuccessRes(req, {
      eojList: this._device.getCurrentEojList(),
    });
    return req;
  }

  // デバイス EOJ 一括登録
  async _deviceEojsPut(req: any): Promise<any> {
    const p = req['params'];
    if (!p) {
      this._setReqToErrorRes(req, 1, 400, 'No parameter');
      return req;
    }
    if (!('eojList' in p)) {
      this._setReqToErrorRes(req, 1, 400, 'The `eojList` is required.');
      return req;
    }
    const list = p['eojList'];
    if (!Array.isArray(list) || list.length === 0) {
      this._setReqToErrorRes(
        req,
        1,
        400,
        'The `eojList` must be a non-empty array.',
      );
      return req;
    }

    // 登録処理
    const res = await this._device.setCurrentEojList(list);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        eojList: res['data']['eojList'],
      });
    } else {
      this._setReqToErrorRes(req, 1, 400, res['message']);
    }
    return req;
  }

  // デバイス EOJ 新規登録
  async _deviceEojsPost(req: any): Promise<any> {
    const p = req['params'];
    if (!p) {
      this._setReqToErrorRes(req, 1, 400, 'No parameter');
      return req;
    }
    if (!('eoj' in p)) {
      this._setReqToErrorRes(req, 1, 400, 'The `eoj` is required.');
      return req;
    }
    if ('epc' in p) {
      const list = p['epc'];
      if (!Array.isArray(list) || list.length === 0) {
        this._setReqToErrorRes(
          req,
          1,
          400,
          'The `epc` must be a non-empty array.',
        );
        return req;
      }
    }
    if ('release' in p) {
      const r = p['release'];
      if (!/^[a-zA-Z]$/.test(r)) {
        this._setReqToErrorRes(
          req,
          1,
          400,
          'The `release` must be an alphabetical letter ([a-zA-Z]).',
        );
        return req;
      }
    }
    const res = await this._device.addCurrentEoj(p);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, res['data']);
    } else {
      this._setReqToErrorRes(req, 1, 400, res['message']);
    }
    return req;
  }

  // デバイス EOJ 取得
  async _deviceEojsEojGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();
    const o = this._device.getCurrentEoj(eoj);
    if (o) {
      this._setReqToSuccessRes(req, o);
    } else {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EOJ was not found in the device EOJ list: ' + eoj,
      );
    }
    return req;
  }

  // デバイス EOJ 修正
  async _deviceEojsEojPut(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();

    let p = req['params'];
    if (!p) {
      p = {};
    }
    if ('epc' in p) {
      const list = p['epc'];
      if (!Array.isArray(list) || list.length === 0) {
        this._setReqToErrorRes(
          req,
          1,
          400,
          'The `epc` must be a non-empty array.',
        );
        return req;
      }
    }

    p['eoj'] = eoj;

    const res = await this._device.updateCurrentEoj(p);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, res['data']);
    } else {
      if (res['result'] === 404) {
        this._setReqToErrorRes(req, 1, 404, res['message']);
      } else {
        this._setReqToErrorRes(req, 1, 400, res['message']);
      }
    }
    return req;
  }

  // デバイス EOJ 削除
  async _deviceEojsEojDelete(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();

    const res = await this._device.deleteCurrentEoj(eoj);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, res['data']);
    } else {
      if (res['result'] === 404) {
        this._setReqToErrorRes(req, 1, 404, res['message']);
      } else {
        this._setReqToErrorRes(req, 1, 400, res['message']);
      }
    }
    return req;
  }

  // デバイス EPC データ (EDT) 一括取得
  async _deviceEpcsGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();

    const o = this._device.getCurrentEoj(eoj);
    if (!o) {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EOJ was not found: ' + eoj,
      );
      return req;
    }

    const props: any = [];
    o['epc'].forEach((epc: any) => {
      props.push({
        epc: epc,
        edt: true,
      });
    });

    const res = await this._device.getEpcValues(eoj, props);
    this._setReqToSuccessRes(req, {
      elProperties: res['elProperties'],
    });
    return req;
  }

  // デバイス EPC データ (EDT) 一括設定
  async _deviceEpcsPut(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();

    const o = this._device.getCurrentEoj(eoj);
    if (!o) {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EOJ was not found: ' + eoj,
      );
      return req;
    }

    const p = req['params'];

    if (!p || typeof p !== 'object') {
      return this._setReqTo400Res(req, 'No parameter was found.');
    }

    const vals = p['vals'];
    if (!vals) {
      return this._setReqTo400Res(req, 'The `vals` is required.');
    } else if (typeof vals !== 'object' || Object.keys(vals).length === 0) {
      return this._setReqTo400Res(req, 'The `vals` must be a non-empty object.');
    }

    const props = [];
    const epc_list = Object.keys(vals);
    let err = '';
    for (let i = 0, len = epc_list.length; i < len; i++) {
      const epc = epc_list[i] as string;
      const edt = vals[epc] as string;
      if (!/^[0-9A-F]{2}$/.test(epc)) {
        err = 'Invalid EPC: ' + epc;
        break;
      }
      if (
        edt === null ||
        edt === undefined ||
        !/^[0-9A-F]+$/.test(edt) ||
        edt.length % 2 !== 0
      ) {
        err = 'Invalid EDT: ' + edt;
        break;
      }
      props.push({
        epc: epc,
        edt: edt,
      });
    }

    if (err) {
      return this._setReqTo400Res(req, err);
    }

    const res = await this._device.setEpcValues(eoj, props);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        changed: res['changed'],
      });
      return req;
    } else {
      return this._setReqTo400Res(req, res['message']);
    }
  }

  // デバイス EPC データ (EDT) 個別取得
  async _deviceEpcsEpcGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();
    const epc = path_part_list[6].toUpperCase();

    const o = this._device.getCurrentEoj(eoj);
    if (!o) {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EOJ was not found: ' + eoj,
      );
      return req;
    }

    const props = [{epc: epc, edt: ''}];
    const res = await this._device.getEpcValues(eoj, props);
    const prop_list = res['elProperties'];
    if (
      prop_list &&
      Array.isArray(prop_list) &&
      prop_list.length > 0 &&
      prop_list[0]['edt']
    ) {
      this._setReqToSuccessRes(req, {
        elProperty: prop_list[0],
      });
    } else {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EPC was not found: ' + epc,
      );
    }
    return req;
  }

  // デバイス EPC データ (EDT) 個別設定
  async _deviceEpcsEpcPut(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const eoj = path_part_list[4].toUpperCase();
    const epc = path_part_list[6].toUpperCase();

    const o = this._device.getCurrentEoj(eoj);
    if (!o) {
      this._setReqToErrorRes(
        req,
        1,
        404,
        'The specified EOJ was not found: ' + eoj,
      );
      return req;
    }

    const p = req['params'];

    if (!p || typeof p !== 'object') {
      return this._setReqTo400Res(req, 'No parameter was found.');
    }

    const edt = p['edt'];
    if (!edt) {
      return this._setReqTo400Res(req, 'The `edt` is required.');
    } else if (
      typeof edt !== 'string' ||
      !/^[0-9A-F]+$/.test(edt) ||
      edt.length % 2 !== 0
    ) {
      return this._setReqTo400Res(req, 'The `edt` is invalid as an EDT.');
    }

    const props = [
      {
        epc: epc,
        edt: edt,
      },
    ];

    const res = await this._device.setEpcValues(eoj, props);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        changed: res['changed'],
      });
      return req;
    } else {
      return this._setReqTo400Res(req, res['message']);
    }
  }

  // EL パケット送信
  async _devicePacketPost(req: any): Promise<any> {
    /* ----------------------------------------------------------
     * req['params]     | Object  | required |
     *   - address      | String  | required | 宛先 IP アドレス
     *   - packet       | Object  | required | パケットを表すハッシュオブジェクト
     *     - tid        | integer | optional | 指定がなけれは自動採番
     *     - seoj       | string  | required | 16進数文字列 (例: "013001")
     *     - deoj       | string  | required | 16進数文字列 (例: "05FF01")
     *     - esv        | string  | required | ESV キーワード (例: "GET_RES") または 16進数文字列
     *     - properties | array   | required | object のリスト
     *       - epc      | string  | required | EPCの16進数文字列 (例: "80")
     *       - edt      | string  | optional | EDTの16進数文字列
     * --------------------------------------------------------- */
    const p = structuredClone(req['params']);

    if (!p || typeof p !== 'object') {
      return this._setReqTo400Res(req, 'Address and packet informaion are reuqired.');
    }

    const address = p['address'];
    if (!address) {
      return this._setReqTo400Res(req, 'The `address` is required.');
    } else if (typeof address !== 'string') {
      return this._setReqTo400Res(req, 'The `address` must be an IP address.');
    }

    const packet = p['packet'];
    if (!packet) {
      return this._setReqTo400Res(req, 'The `packet` is required.');
    } else if (typeof packet !== 'object') {
      return this._setReqTo400Res(req, 'The `packet` must be an object representing a packet.');
    }

    const tid = packet['tid'];
    if (tid && typeof tid === 'string' && /^\d+$/.test(tid)) {
      packet['tid'] = parseInt(tid, 10);
    }

    const res = await this._device.sendPacket(address, packet);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req);
      return req;
    } else {
      return this._setReqTo400Res(req, res['message']);
    }
  }

  // リモートデバイスの一覧を取得
  async _controllerRemoteDevicesGet(req: any): Promise<any> {
    const res = this._device.getRemoteDeviceList();
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        remoteDeviceList: res['remoteDeviceList'],
      });
    } else {
      this._setReqToErrorRes(req, 1, res['code'], res['message']);
    }
    return req;
  }

  // リモートデバイスをクリア
  async _controllerRemoteDevicesDelete(req: any): Promise<any> {
    const res = this._device.deleteRemoteDeviceList();
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, null);
    } else {
      this._setReqToErrorRes(req, 1, res['code'], res['message']);
    }
    return req;
  }

  // リモートデバイスの EPC データ (EDT) の個別取得
  async _controllerRemoteDevicesEpcGet(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const address = path_part_list[4];
    const eoj = path_part_list[6].toUpperCase();
    const epc = path_part_list[8].toUpperCase();
    const res = await this._device.getRemoteDeviceEpcData(address, eoj, epc);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        elProperty: res['elProperty'],
      });
    } else {
      this._setReqToErrorRes(req, 1, res['code'], res['message']);
    }
    return req;
  }

  // リモートデバイスの EPC データ (EDT) の個別設定
  async _controllerRemoteDevicesEpcPut(req: any): Promise<any> {
    const path_part_list = req['path'].split(/\//);
    const address = path_part_list[4];
    const eoj = path_part_list[6].toUpperCase();
    const epc = path_part_list[8].toUpperCase();

    const p = req['params'];

    if (!p || typeof p !== 'object') {
      return this._setReqTo400Res(req, 'Parameter Error');
    }

    const edt = p['edt'];

    if (!edt) {
      return this._setReqTo400Res(req, 'The `edt` is required.');
    } else if (typeof edt !== 'string') {
      return this._setReqTo400Res(req, 'The `edt` must be an IP address.');
    }

    const res = await this._device.setRemoteDeviceEpcData(address, eoj, epc, edt);
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req, {
        property: res['property'],
      });
    } else {
      this._setReqToErrorRes(req, 1, res['code'], res['message']);
    }
    return req;
  }

  // デバイス発見パケットを送信
  async _controllerDiscoveryPost(req: any): Promise<any> {
    const res = await this._device.sendDiscoveryPacket();
    if (res['result'] === 0) {
      this._setReqToSuccessRes(req);
    } else {
      this._setReqToErrorRes(req, 1, res['code'], res['message']);
    }
    return req;
  }
}

export default HttpApi;
