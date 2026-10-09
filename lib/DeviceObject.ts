/* ------------------------------------------------------------------
 * デバイスオブジェクトのモジュール
 * ---------------------------------------------------------------- */
import {EventEmitter} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import DeviceState from './DeviceState.ts';

/* ------------------------------------------------------------------
 * イベント:
 * - send(address, packet) : EL パケットを送信する
 * - epcupdated(eoj, props) : EPC の値が更新された
 * ---------------------------------------------------------------- */
class DeviceObject extends EventEmitter {
  _conf: any;
  _desc: any;
  _eoj: any;
  _eoj_settings: any;
  _ip_address_utils: any;
  _parser: any;
  _standard_version: any;
  _states: any;
  _user_init_values: any;
  /* ------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */
  constructor(
    eoj: any,
    desc: any,
    user_init_values: any,
    conf: any,
    ip_address_utils: any,
    standard_version: any,
    parser: any,
    eoj_settings: any,
  ) {
    super();
    this._eoj = eoj;
    this._desc = structuredClone(desc);
    this._user_init_values = user_init_values || {};
    this._conf = conf;
    this._ip_address_utils = ip_address_utils;
    this._standard_version = standard_version;
    this._parser = parser;
    this._eoj_settings = eoj_settings || {};

    this._states = null; // DeviceState オブジェクトのインスタンス
  }

  updateConf(conf: any): any {
    this._conf = structuredClone(conf);
  }

  /* ------------------------------------------------------------------
   * init()
   * 初期化する
   * ---------------------------------------------------------------- */
  init(): any {
    // DeviceState オブジェクトを生成
    this._states = new DeviceState(
      this._eoj,
      this._desc,
      this._user_init_values,
      this._conf,
      this._standard_version,
      this._parser,
      this._eoj_settings,
    );
    this._states.init();

    // EDT データに変化があった時に呼び出されるイベントハンドラをセット
    this._states.on('change', (changed: any) => {
      // EPC 更新イベント発火
      this.emit('epcupdated', this._eoj, changed);
      // 状態変化 INF をマルチキャスト送信
      this._sendStatusChangeInf(null, changed);
    });
  }

  /* ------------------------------------------------------------------
   * getStandardVersion()
   * リリースバージョンを返す
   *
   * 引数:
   * - なし
   *
   * 戻値:
   * - リリースバージョン (例: "J")
   * ---------------------------------------------------------------- */
  getStandardVersion(): any {
    return this._standard_version;
  }

  /* ------------------------------------------------------------------
   * getAccessRule(epc)
   * EPC に対するアクセスルールを返す
   *
   * 引数:
   * - epc    | String | required | EPC (例: "80")
   *
   * 戻値:
   * {
   *   "get": true,
   *   "set": true,
   *   "inf": false
   * }
   * ---------------------------------------------------------------- */
  getAccessRule(epc: any): any {
    return this._states.getAccessRule(epc);
  }

  /* ------------------------------------------------------------------
   * getEpcValues(props, is_admin)
   * EPC の値 (EDT) を読みだす (ダッシュボード向け)
   *
   * 引数:
   * - props    | Array   | required |
   *     - 例: [{"epc": "8A", "edt":"any"}, ...]
   *     - epc の値しか見ないので edt の any の部分は何が入っていても構わない
   * - is_admin | Boolean | optional |
   *     - true なら、Device Description のアクセスルールをチェックせずに
   *       強制的に実行する。主にダッシュボード向けに使うモード。
   *     - false なら Device Description のアクセスルールに基づいた動作を
   *       行う。主に EL パケット受信時の処理のために使うモード。
   *     - デフォルトは false。
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   * {
   *    result  : 読み出しに失敗した EDT の数 (つまりすべて成功すれば 0),
   *    message : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
   *    vals    : 読み出しに成功した EDT にはその値 が、失敗した EDT には null がセット
   *  }
   *
   * reject() は本メソッドに渡されたパラメータに不備があった場合のみ呼び出される。
   * ---------------------------------------------------------------- */
  getEpcValues(props: any, is_admin?: any): Promise<any> {
    return this._states.getEpcValues(props, is_admin);
  }

  /* ------------------------------------------------------------------
   * setEpcValues(props, is_admin, set_delay_msec)
   * EPC の値 (EDT) を書き込む
   *
   * 引数:
   * - props    | Array   | required |
   *     - 例: [{"epc": "8A", "edt":"any"}, ...]
   * - is_admin | Boolean | optional |
   *     - true なら、Device Description のアクセスルールをチェックせずに
   *       強制的に実行する。主にダッシュボード向けに使うモード。
   *     - false なら Device Description のアクセスルールに基づいた動作を
   *       行う。主に EL パケット受信時の処理のために使うモード。
   *     - デフォルトは false。
   * - set_delay_msec | Number | optional |
   *     - 実際に EPC データを書き込む際の遅延時間 (ミリ秒)。
   *     - is_admin が false の場合のみ有効。
   *     - 実際に EPC データを書き込む前に resolve() を呼び出す。
   *     - EL パケット受信時の処理のために使うオプション。
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
  setEpcValues(props: any, is_admin: any, set_delay_msec?: any): Promise<any> {
    return this._states.setEpcValues(props, is_admin, set_delay_msec);
  }

  /* ------------------------------------------------------------------
   * receive(address, parsed)
   * EL パケット受信時の処理
   * - address: 発信元IPアドレス
   * - parsed : EL パケット解析済みデータ
   * ---------------------------------------------------------------- */
  receive(address: any, parsed: any): any {
    // 送信専用ノードプロファイルなら受信パケットは無視
    if (this._eoj === '0EF002') {
      return;
    }

    const d = parsed['data']['data'];

    const packet: any = {
      tid: d['tid']['value'],
      seoj: d['seoj']['hex'],
      deoj: d['deoj']['hex'],
      esv: d['esv']['hex'],
      properties: [],
    };

    const props = d['properties'];
    for (let i = 0, len = props.length; i < len; i++) {
      const prop = props[i];
      packet['properties'].push({
        epc: prop['epc']['hex'],
        edt: prop['edt']['hex'],
      });
    }

    if (d['properties2']) {
      packet['properties2'] = [];
      const props2 = d['properties2'];
      for (let i = 0, len = props2.length; i < len; i++) {
        const prop2 = props2[i];
        packet['properties2'].push({
          epc: prop2['epc']['hex'],
          edt: prop2['edt']['hex'],
        });
      }
    }

    const esv = packet['esv'];
    if (esv === '60') {
      // SetI 書き込み要求：応答不要
      this._receiveReqSetI(address, packet);
    } else if (esv === '61') {
      // SetC 書き込み要求：応答要
      this._receiveReqSetC(address, packet);
    } else if (esv === '62') {
      // Get 読み出し要求
      this._receiveReqGet(address, packet);
    } else if (esv === '63') {
      // INF_REQ 通知要求
      this._receiveReqInfReq(address, packet);
    } else if (esv === '6E') {
      // SetGet 書き込み・読み出し要求
      this._receiveReqSetGet(address, packet);
    } else if (esv === '74') {
      // INFC 通知：応答要
      this._receiveReqInfC(address, packet);
    }
    // ESV が上記以外は無視
  }

  // SetI 書き込み要求：応答不要
  async _receiveReqSetI(address: any, packet: any): Promise<void> {
    const epc_list: any = [];
    packet['properties'].forEach((o: any) => {
      epc_list.push(o['epc']);
    });
    const set_delay_msec = this._getSetDelayMsec(epc_list);

    let res;
    try {
      res = await this.setEpcValues(
        packet['properties'],
        false,
        set_delay_msec,
      );
    } catch (error) {
      console.error(error);
      return;
    }
    // 失敗があった時だけ SNA を返す
    if (res['result'] > 0) {
      const res_packet = this._createSnaPacket(packet, res['vals']);
      await sleep(this._getResponseWaitMsec(packet, Object.keys(res['vals'])));
      this.emit('send', address, res_packet);
    }
  }

  // SetC 書き込み要求：応答要
  async _receiveReqSetC(address: any, packet: any): Promise<void> {
    const epc_list: any = [];
    packet['properties'].forEach((o: any) => {
      epc_list.push(o['epc']);
    });
    const set_delay_msec = this._getSetDelayMsec(epc_list);
    let res;
    try {
      res = await this.setEpcValues(
        packet['properties'],
        false,
        set_delay_msec,
      );
    } catch (error) {
      console.error(error);
      return;
    }
    /*
     * res = {
     *   result  : 保存に失敗した EDT の数 (つまりすべて成功すれば 0),
     *   message : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
     *   vals    : 保存に成功した EDT は null が、失敗した EDT は引数の vals と同じ (SNA を想定),
     *   changed : 変更があった ECP と EDT のハッシュオブジェクト (状態変化INFの情報源として使われる)
     * }
     */
    let res_packet: any = null;
    if (res['result'] === 0) {
      res_packet = this._createResPacket(packet, res['vals']);
    } else {
      res_packet = this._createSnaPacket(packet, res['vals']);
    }
    await sleep(this._getResponseWaitMsec(packet, Object.keys(res['vals'])));
    this.emit('send', address, res_packet);
  }

  // 状態変化 INF 送信 (マルチキャスト送信)
  _sendStatusChangeInf(packet: any, changed: any): any {
    // 引数 packet が存在する場合は INF_REQ に対する応答
    // 存在しなければ、純粋な状態変化を意味する

    if (
      !changed ||
      typeof changed !== 'object' ||
      Object.keys(changed).length === 0
    ) {
      return;
    }

    const props: any = {};
    Object.keys(changed).forEach(epc => {
      const epc_data = this._desc['elProperties'][epc];
      if (!epc_data || !epc_data['accessRule']) {
        return;
      }
      // アクセスルールをチェック
      // ただし、INF_REQ の場合は get が true なら OK
      const rule = this.getAccessRule(epc);
      if (packet) {
        if (!rule['get']) {
          return;
        }
      } else {
        if (!rule['inf']) {
          return;
        }
      }
      props[epc] = changed[epc];
    });

    if (Object.keys(props).length === 0) {
      return;
    }

    const inf_packet: any = {
      seoj: this._eoj,
      deoj: packet ? packet['seoj'] : '0EF001',
      esv: '73',
      properties: [],
    };

    if (packet) {
      inf_packet['tid'] = packet['tid'];
      // INF_REQ の場合は、
      // 1081 6648 05FF01 013001 63(INF_REQ) 02(OPC) 80 00 80 00
      // のように、同じ EPC を 2 回以上繰り返す場合があるので、
      // リクエストの順番通りに値をセットする
      //
      // ただし、EPC=0x00 のような EDT を特定できないものが
      // リクエストされた場合は、ESV=0x53(INF_SNA) を返す
      packet['properties'].forEach((p: any) => {
        const epc = p['epc'];
        const edt = props[epc];
        inf_packet['properties'].push({
          epc: epc,
          edt: edt,
        });
        if (!edt) {
          inf_packet['esv'] = '53';
        }
      });
    } else {
      Object.keys(props).forEach(epc => {
        const edt = props[epc];
        inf_packet['properties'].push({
          epc: epc,
          edt: edt,
        });
      });
    }

    this.emit('send', null, inf_packet);
  }

  // Get 読み出し要求
  async _receiveReqGet(address: any, packet: any): Promise<void> {
    let res;
    try {
      res = await this._states.getEpcValues(packet['properties']);
    } catch (error) {
      console.error(error);
      return;
    }
    /*
     * res = {
     *   result  : 読み出しに失敗した EDT の数 (つまりすべて成功すれば 0),
     *   message : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
     *   vals    : 読み出しに成功した EDT にはその値 が、失敗した EDT には null がセット (SNA を想定)
     * }
     */
    let res_packet: any = null;
    if (res['result'] === 0) {
      res_packet = this._createResPacket(packet, res['vals']);
    } else {
      res_packet = this._createSnaPacket(packet, res['vals']);
    }
    await sleep(this._getResponseWaitMsec(packet, Object.keys(res['vals'])));
    this.emit('send', address, res_packet);
  }

  _getSetDelayMsec(epc_list: any): any {
    if (!epc_list || !Array.isArray(epc_list)) {
      epc_list = [];
    }
    let msec = 0;
    epc_list.forEach((epc_hex: any) => {
      const s = this._eoj_settings[epc_hex];
      if (s && s['settingTime'] && typeof s['settingTime'] === 'number') {
        if (s['settingTime'] > msec) {
          msec = s['settingTime'];
        }
      }
    });
    if (msec > 0) {
      return msec;
    } else {
      return this._conf['epc_data_setting_time_msec'];
    }
  }

  _getResponseWaitMsec(req_packet: any, epc_list: any): any {
    if (!epc_list || !Array.isArray(epc_list)) {
      epc_list = [];
    }

    const getWaitMsec = (k: any) => {
      let msec = this._conf[k + '_res_wait_msec'];
      epc_list.forEach((epc_hex: any) => {
        const s = this._eoj_settings[epc_hex];
        if (
          s &&
          s['responseTime'] &&
          typeof s['responseTime'] === 'object' &&
          s['responseTime'][k]
        ) {
          if (s['responseTime'][k] > msec) {
            msec = s['responseTime'][k];
          }
        }
      });
      return msec;
    };

    if (this._isMulticastRequest(req_packet)) {
      let min = this._conf['multicast_response_wait_min_msec'];
      let max = this._conf['multicast_response_wait_max_msec'];
      if (min === max) {
        return max;
      }
      if (min > max) {
        const tmp = min;
        min = max;
        max = tmp;
      }
      const r = max - min;
      const wait = min + Math.floor(Math.random() * (r + 1));
      return wait;
    } else {
      const esv = req_packet['esv'];
      let wait = 0;
      if (esv === '60') {
        // SetI 書き込み要求：応答不要 (SNA を返す場合のみ)
        //return this._conf['set_res_wait_msec'];
        wait = getWaitMsec('set');
      } else if (esv === '61') {
        // SetC 書き込み要求：応答要
        //return this._conf['set_res_wait_msec'];
        wait = getWaitMsec('set');
      } else if (esv === '62') {
        // Get 読み出し要求
        //return this._conf['get_res_wait_msec'];
        wait = getWaitMsec('get');
      } else if (esv === '63') {
        // INF_REQ 通知要求
        //return this._conf['inf_res_wait_msec'];
        wait = getWaitMsec('inf');
      } else if (esv === '6E') {
        // SetGet 書き込み・読み出し要求
        //return this._conf['set_res_wait_msec'];
        wait = getWaitMsec('set');
      } else if (esv === '74') {
        // INFC 通知：応答要
        //return this._conf['inf_res_wait_msec'];
        wait = getWaitMsec('inf');
      }
      return wait;
    }
  }

  _isMulticastRequest(req_packet: any): any {
    const p = req_packet;
    if (/00$/.test(p['deoj']) && /^(61|62|63|6E)$/.test(p['esv'])) {
      return true;
    } else {
      return false;
    }
  }

  // INF_REQ 通知要求
  async _receiveReqInfReq(address: any, packet: any): Promise<void> {
    let res;
    try {
      res = await this._states.getEpcValues(packet['properties']);
    } catch (error) {
      // パケットが壊れているので何もしない
      console.error(error);
      return;
    }
    /*
     * res = {
     *   result  : 読み出しに失敗した EDT の数 (つまりすべて成功すれば 0),
     *   message : エラーメッセージ、エラーがなければ null, 複数の失敗があれば最後のエラーメッセージがセット,
     *   vals    : 読み出しに成功した EDT にはその値 が、失敗した EDT には null がセット (SNA を想定)
     * }
     */
    await sleep(this._getResponseWaitMsec(packet, Object.keys(res['vals'])));
    if (res['result'] === 0) {
      // 状態変化 INF をマルチキャスト送信
      this._sendStatusChangeInf(packet, res['vals']);
    } else {
      // INF_SNA をユニキャスト送信
      const res_packet = this._createSnaPacket(packet, res['vals']);
      this.emit('send', address, res_packet);
    }
  }

  // SetGet 書き込み・読み出し要求
  _receiveReqSetGet(address: any, packet: any): any {
    // PacketComposer に SetGet に関連するパケット生成の仕組みがないので、
    // SetGet は扱わない。ここではすべて SetGetSNA を返す
    const res_packet = this._createSnaPacket(packet, []);
    this.emit('send', address, res_packet);

    /*
    let epc_list = [];
    packet['properties'].forEach((o) => {
      epc_list.push(o['epc']);
    });
    let set_delay_msec = this._getSetDelayMsec(epc_list);

    let props = packet['properties'];
    let props2 = packet['properties2'];
    if (!props2) {
      props2 = [];
    }

    this.setEpcValues(props, false, set_delay_msec).then((res) => {
      return this._states.getEpcValues(props2);
    }).then((res) => {
      let res_packet = null;

      if (res['result'] === 0) {
        res_packet = this._createResPacket(packet, res['vals']);
      } else {
        res_packet = this._createSnaPacket(packet, []);
      }

      setTimeout(() => {
        this.onsend(address, res_packet);
      }, set_delay_msec);
    }).catch((error) => {
      let res_packet = this._createSnaPacket(packet, []);
      this.onsend(address, res_packet);
    });
    */
  }

  // 0x74 INFC 通知：応答要
  async _receiveReqInfC(address: any, packet: any): Promise<void> {
    const props: any = {};
    const epc_list: any = [];
    packet['properties'].forEach((p: any) => {
      props[p['epc']] = null;
      epc_list.push(p['epc']);
    });
    const res_packet = this._createResPacket(packet, props);
    await sleep(this._getResponseWaitMsec(packet, epc_list));
    this.emit('send', address, res_packet);
  }

  _createSnaPacket(packet: any, props: any): any {
    /* ----------------------------------------------------------------
     * packet: リクエストのパケット
     *   - tid        | integer | optional | 指定がなけれは自動採番
     *   - seoj       | string  | required | 16進数文字列 (例: "013001")
     *   - deoj       | string  | required | 16進数文字列 (例: "05FF01")
     *   - esv        | string  | required | 16進数文字列
     *   - properties | array   | required | object のリスト
     *     - epc      | string  | required | EPCの16進数文字列 (例: "80")
     *     - edt      | string  | optional | EDTの16進数文字列
     * ------------------------------------------------------------- */

    // リクエストの ESV に対応する SNA の ESV に変換
    const esv = packet['esv'];
    const esv1 = esv.substr(0, 1);
    const esv2 = esv.substr(1, 1);
    if (esv1 !== '6' || !/^(0|1|2|3|E)$/.test(esv2)) {
      return null;
    }
    const sna_esv = '5' + esv2;

    const sna_packet: any = {
      //tid: parseInt(packet['tid'], 16),
      tid: packet['tid'],
      seoj: this._eoj,
      deoj: packet['seoj'],
      esv: sna_esv,
      properties: [],
    };

    if (esv !== '6E') {
      const prop_list = packet['properties'];
      for (let i = 0, len = prop_list.length; i < len; i++) {
        const prop = prop_list[i];
        const epc = prop['epc'];
        let edt = prop['edt'];
        if (props && epc in props) {
          edt = props[epc];
        }
        sna_packet['properties'].push({
          epc: epc,
          edt: edt,
        });
      }
    }
    return sna_packet;
  }

  _createResPacket(packet: any, props: any): any {
    /* ----------------------------------------------------------------
     * packet:
     *   - tid        | integer | optional | 指定がなけれは自動採番
     *   - seoj       | string  | required | 16進数文字列 (例: "013001")
     *   - deoj       | string  | required | 16進数文字列 (例: "05FF01")
     *   - esv        | string  | required | ESV キーワード (例: "GET_RES")
     *   - properties | array   | required | object のリスト
     *     - epc      | string  | required | EPCの16進数文字列 (例: "80")
     *     - edt      | string  | optional | EDTの16進数文字列
     * ------------------------------------------------------------- */

    // リクエストの ESV に対応する SNA の ESV に変換
    let esv = packet['esv'];
    const esv1 = esv.substr(0, 1);
    const esv2 = esv.substr(1, 1);
    if (!/^(61|62|63|6E|74)$/.test(esv)) {
      return null;
    }

    if (esv1 === '6') {
      esv = '7' + esv2;
    } else {
      esv = '7A';
    }

    const res_packet: any = {
      tid: packet['tid'],
      seoj: this._eoj,
      deoj: packet['seoj'],
      esv: esv,
      properties: [],
    };

    const prop_list = packet['properties'];
    for (let i = 0, len = prop_list.length; i < len; i++) {
      const prop = prop_list[i];
      const epc = prop['epc'];
      let edt = prop['edt'];
      if (props && epc in props) {
        edt = props[epc];
      }
      res_packet['properties'].push({
        epc: epc,
        edt: edt,
      });
    }

    return res_packet;
  }
}

export default DeviceObject;
