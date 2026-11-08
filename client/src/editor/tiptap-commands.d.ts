import '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableImage: {
      setImageWrap: (wrap: string) => ReturnType;
      setImageMarginIn: (inches: number) => ReturnType;
      setImagePositionMode: (mode: string) => ReturnType;
      setImageWrapAlign: (align: string) => ReturnType;
      setImageRepeatOnPages: (enabled: boolean) => ReturnType;
      resetImageSize: () => ReturnType;
    };
  }
}

export {};
