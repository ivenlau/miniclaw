declare module 'dingtalk-stream-sdk-nodejs' {
  interface DWClientOptions {
    clientId: string;
    clientSecret: string;
  }

  class DWClient {
    constructor(options: DWClientOptions);
    registerCallbackListener(path: string, handler: (event: any) => void): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage?(options: any): Promise<void>;
  }

  export default DWClient;
}
