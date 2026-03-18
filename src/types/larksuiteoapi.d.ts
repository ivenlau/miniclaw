declare module '@larksuiteoapi/node-sdk' {
  export enum AppType {
    SelfBuild = 'self_build',
  }

  export enum LoggerLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
  }

  export class Client {
    constructor(options: {
      appId: string;
      appSecret: string;
      appType?: AppType;
    });
    im: {
      message: {
        create(options: {
          data: {
            receive_id: string;
            msg_type: string;
            content: string;
          };
          params: { receive_id_type: string };
        }): Promise<any>;
      };
    };
  }

  export class EventDispatcher {
    constructor(options: Record<string, any>);
    register(handlers: Record<string, (data: any) => Promise<void>>): this;
  }

  export class WSClient {
    constructor(options: {
      appId: string;
      appSecret: string;
      eventDispatcher: EventDispatcher;
      loggerLevel?: LoggerLevel;
    });
    start(): Promise<void>;
  }
}
