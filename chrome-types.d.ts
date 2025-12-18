// Type definitions for Chrome Extension APIs
// Project: snap-it-like-its-hot
// Definitions for Chrome Extensions Manifest V3

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      tlsChannelId?: string;
    }

    interface LastError {
      message?: string;
    }

    let lastError: LastError | undefined;

    interface MessageEvent {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
    }

    let onMessage: MessageEvent;
  }

  namespace tabs {
    interface MutedInfo {
      muted: boolean;
      reason?: string;
      extensionId?: string;
    }

    interface Tab {
      id?: number;
      index: number;
      windowId: number;
      openerTabId?: number;
      selected: boolean;
      highlighted: boolean;
      active: boolean;
      pinned: boolean;
      audible?: boolean;
      discarded: boolean;
      autoDiscardable: boolean;
      mutedInfo?: MutedInfo;
      url?: string;
      title?: string;
      favIconUrl?: string;
      status?: string;
      incognito: boolean;
      width?: number;
      height?: number;
      sessionId?: string;
    }

    interface UpdateProperties {
      active?: boolean;
    }

    function update(
      tabId: number,
      updateProperties: UpdateProperties,
      callback?: (tab: Tab) => void
    ): void;

    interface CaptureVisibleTabOptions {
      format?: "jpeg" | "png";
      quality?: number;
    }

    function captureVisibleTab(
      windowId: number,
      options: CaptureVisibleTabOptions,
      callback: (dataUrl: string) => void
    ): void;

    function query(
      queryInfo: Record<string, any>
    ): Promise<Tab[]>;

    function sendMessage(
      tabId: number,
      message: any,
      responseCallback?: (response: any) => void
    ): void;
  }

  namespace downloads {
    interface DownloadOptions {
      url: string;
      filename?: string;
      conflictAction?: string;
      saveAs?: boolean;
      method?: string;
      headers?: Record<string, string>[];
      body?: string;
    }

    function download(
      options: DownloadOptions,
      callback?: (downloadId: number) => void
    ): void;
  }

  namespace scripting {
    interface InjectionTarget {
      tabId: number;
      frameIds?: number[];
      allFrames?: boolean;
    }

    interface ScriptInjection {
      target: InjectionTarget;
      files?: string[];
      func?: () => void;
      args?: any[];
    }

    function executeScript(
      injection: ScriptInjection,
      callback?: (results: any[]) => void
    ): Promise<any[]>;
  }
}

