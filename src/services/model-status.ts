import { RECOGNITION_WORD_LABELS } from '@/recognition/expanded-vocabulary';

export type ModelStatus = {
  ready: boolean;
  label: string;
  version: string | null;
  supportedSigns: readonly string[];
  message: string;
  trackingBundled: boolean;
  supportsGrammar: boolean;
  sentenceTranslation: 'experimental-offline';
};

/** Bundled isolated-word classification is distinct from continuous ASL translation. */
export const ModelStatusService = {
  getStatus(): ModelStatus {
    return {
      ready: true,
      label: `MediaPipe + ${RECOGNITION_WORD_LABELS.length.toLocaleString()} supported words`,
      version: 'ASL Citizen 17f0148 (2,731 classes) + TGCN-WLASL dacb456 (2,000 classes)',
      supportedSigns: RECOGNITION_WORD_LABELS,
      trackingBundled: true,
      supportsGrammar: true,
      sentenceTranslation: 'experimental-offline',
      message: `The dictionary includes all ${RECOGNITION_WORD_LABELS.length.toLocaleString()} distinct entries supported by the pretrained word models. The 500-word restriction has been removed. All predictions require review. Personal learning and held-out tests are available in Recognition Lab. Live word accuracy is unvalidated. Live sentence accuracy is unvalidated.`,
    };
  },
}; 

