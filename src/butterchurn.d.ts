// butterchurn no trae tipos. Declaración mínima de lo que usamos (MilkDrop WebGL).
declare module 'butterchurn' {
  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    loadPreset(preset: unknown, blendTime?: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }
  const butterchurn: {
    createVisualizer(
      audioContext: BaseAudioContext,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number }
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, unknown> };
  export default presets;
}
