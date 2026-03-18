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
        reply(options: {
          path: { message_id: string };
          data: {
            msg_type: string;
            content: string;
          };
        }): Promise<any>;
      };
      messageResource: {
        get(options: {
          path: { message_id: string; file_key: string };
          params: { type: string };
        }): Promise<ReadableStream | any>;
      };
      image: {
        create(options: {
          data: {
            image_type: string;
            image: any;
          };
        }): Promise<any>;
        get(options: {
          path: { image_key: string };
        }): Promise<any>;
      };
      file: {
        create(options: {
          data: {
            file_type: string;
            file_name: string;
            file: any;
          };
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
