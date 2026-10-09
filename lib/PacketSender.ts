/* ------------------------------------------------------------------
 * - EL パケットを送信するモジュール
 * - 同時に EL パケットを送信することがないようキュー管理する
 * ---------------------------------------------------------------- */
import {setTimeout as sleep} from 'node:timers/promises';

class PacketSender {
  _conf: any;
  _ip_address_utils: any;
  _queue: Promise<void>;
  _udp: any;
  constructor(conf: any, udp: any, ip_address_utils: any) {
    this._conf = conf;
    this._udp = udp;
    this._ip_address_utils = ip_address_utils;

    // パケット送信を直列化するための Promise チェーン
    this._queue = Promise.resolve();
  }

  /* ------------------------------------------------------------------
   * send(address, buf)
   * - パケットを送信する
   *
   * 引数
   * - address | String | optional | 宛先 IP アドレス。
   *           |        |          | 指定がなければマルチキャストアドレスがセットされる。
   * - buf     | Buffer | required | パケットを表す Buffer オブジェクト
   *
   * 戻値
   * - Promise オブジェクト
   * - resolve() には、送信先の IP アドレスが引き渡される。
   * ---------------------------------------------------------------- */
  async send(address: any, buf: any) {
    // IP アドレスの指定がなければマルチキャストアドレス
    if (!address) {
      address = this._ip_address_utils.getMulticastAddress();
    }
    // 前のパケットの送信完了を待ってから送信する
    const task = this._queue.then(() => this._sendQueuedPacket(address, buf));
    this._queue = task.catch(() => {});
    await task;
    return address;
  }

  async _sendQueuedPacket(address: any, buf: any) {
    // マルチキャストかどうかを判定
    //   - Linux などではメンバーシップをドロップしないといけない。
    //   - その判定のために使う。
    const mc_flag = address === this._ip_address_utils.getMulticastAddress();
    if (!mc_flag) {
      await this._sendPacket(address, buf);
      return;
    }

    // マルチキャストならメンバーシップをドロップしてから処理する
    this._dropMembership();
    await sleep(200);
    try {
      const netif_list = this._ip_address_utils.getNetworkInterfaceList();
      for (const netif of netif_list) {
        this._udp.setMulticastInterface(netif);
        await sleep(100);
        await this._sendPacket(address, buf);
      }
    } finally {
      this._addMembership();
      await sleep(200);
    }
  }

  _sendPacket(address: any, buf: any) {
    return new Promise<void>((resolve, reject) => {
      const port = this._ip_address_utils.getPortNumber();
      try {
        this._udp.send(
          buf,
          0,
          buf.length,
          port,
          address,
          (error: any, _bytes: any) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          },
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  _addMembership() {
    try {
      const netif_list = this._ip_address_utils.getNetworkInterfaceList();
      const mc_address = this._ip_address_utils.getMulticastAddress();
      for (const netif of netif_list) {
        this._udp.addMembership(mc_address, netif);
      }
    } catch (e) {
      console.error(e);
    }
  }

  _dropMembership() {
    try {
      const netif_list = this._ip_address_utils.getNetworkInterfaceList();
      const mc_address = this._ip_address_utils.getMulticastAddress();
      for (const netif of netif_list) {
        this._udp.dropMembership(mc_address, netif);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

export default PacketSender;
