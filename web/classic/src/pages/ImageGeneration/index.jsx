import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Empty,
  InputNumber,
  Modal,
  Select,
  Spin,
  TabPane,
  Tabs,
  Tag,
  TextArea,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import {
  AlertTriangle,
  Brush,
  Circle,
  Copy,
  Download,
  Eraser,
  Eye,
  Images,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { StatusContext } from '../../context/Status';
import {
  API,
  copy,
  fetchTokenKey,
  getUserIdFromLocalStorage,
} from '../../helpers';

const SUPPORTED_IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2'];
const MODEL_PRIORITY = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
const RESPONSE_MODEL_PRIORITY = [
  'gpt-5.5',
  'gpt-5',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5-nano',
  'gpt-5.2',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
];
const HISTORY_STORAGE_KEY = 'ai_image_generation_history';
const FORM_STORAGE_KEY = 'ai_image_generation_form';
const HISTORY_LIMIT = 10;
const HISTORY_DB_NAME = 'ai_image_generation_history_db';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE_NAME = 'history';
const TOKEN_PAGE_SIZE = 100;
const CUSTOM_SIZE_VALUE = 'custom';
const CUSTOM_SIZE_LIMITS = {
  maxEdge: 3840,
  step: 16,
  maxRatio: 3,
  minPixels: 655360,
  maxPixels: 8294400,
};

const MODE_GENERATE = 'generate';
const MODE_EDIT = 'edit';
const MODE_MASK = 'mask';

const DEFAULT_FORM = {
  mode: MODE_GENERATE,
  tokenId: undefined,
  responseModel: RESPONSE_MODEL_PRIORITY[0],
  model: 'gpt-image-2',
  prompt: '',
  size: '1024x1024',
  customWidth: 1024,
  customHeight: 1024,
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  outputCompression: undefined,
};

const SIZE_OPTIONS = [
  { label: '自动', value: 'auto' },
  { label: '1k - 1:1 (1024x1024) - 正方形', value: '1024x1024' },
  { label: '2k - 1:1 (2048x2048) - 正方形', value: '2048x2048' },
  { label: '2k - 3:2 (2016x1344) - 横屏', value: '2016x1344' },
  { label: '2k - 2:3 (1344x2016) - 竖屏', value: '1344x2016' },
  { label: '2k - 4:3 (2048x1536) - 横屏', value: '2048x1536' },
  { label: '2k - 3:4 (1536x2048) - 竖屏', value: '1536x2048' },
  { label: '2k - 16:9 (2048x1152) - 横屏', value: '2048x1152' },
  { label: '2k - 9:16 (1152x2048) - 竖屏', value: '1152x2048' },
  { label: '4k - 1:1 (2880x2880) - 正方形', value: '2880x2880' },
  { label: '4k - 3:2 (3504x2336) - 横屏', value: '3504x2336' },
  { label: '4k - 2:3 (2336x3504) - 竖屏', value: '2336x3504' },
  { label: '4k - 4:3 (3264x2448) - 横屏', value: '3264x2448' },
  { label: '4k - 3:4 (2448x3264) - 竖屏', value: '2448x3264' },
  { label: '4k - 16:9 (3840x2160) - 横屏', value: '3840x2160' },
  { label: '4k - 9:16 (2160x3840) - 竖屏', value: '2160x3840' },
  { label: '自定义', value: CUSTOM_SIZE_VALUE },
];

const QUALITY_OPTIONS = [
  { label: '自动', value: 'auto' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
];

const BACKGROUND_OPTIONS = [
  { label: '自动', value: 'auto' },
  { label: '透明', value: 'transparent' },
  { label: '不透明', value: 'opaque' },
];

const OUTPUT_FORMAT_OPTIONS = [
  { label: 'PNG 图片', value: 'png' },
  { label: 'JPEG 图片', value: 'jpeg' },
  { label: 'WebP 图片', value: 'webp' },
];

const normalizeOptionalInteger = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const MASK_TOOLS = [
  { key: 'brush', label: '笔刷', icon: Brush },
  { key: 'circle', label: '圆形', icon: Circle },
  { key: 'rect', label: '矩形', icon: Square },
  { key: 'eraser', label: '橡皮', icon: Eraser },
];

const isDrawingEnabledFromStatus = (status) => {
  if (typeof status?.enable_drawing === 'boolean') return status.enable_drawing;
  return localStorage.getItem('enable_drawing') === 'true';
};

const normalizeKey = (key) => {
  if (!key) return '';
  return key.startsWith('sk-') ? key : `sk-${key}`;
};

const getBestModel = (availableModels = []) => {
  const availableSet = new Set(availableModels);
  return (
    MODEL_PRIORITY.find((model) => availableSet.has(model)) || MODEL_PRIORITY[0]
  );
};

const isImageToolModelName = (model) => {
  const normalized = String(model || '').toLowerCase();
  return (
    SUPPORTED_IMAGE_MODELS.includes(normalized) ||
    normalized.includes('gpt-image') ||
    normalized.includes('chatgpt-image') ||
    normalized.startsWith('dall-e') ||
    normalized.startsWith('flux') ||
    normalized.startsWith('imagen-')
  );
};

const isResponseModelName = (model) => {
  const normalized = String(model || '').toLowerCase();
  return normalized.startsWith('gpt-') && !isImageToolModelName(normalized);
};

const getBestResponseModel = (availableModels = []) => {
  const availableSet = new Set(availableModels);
  const preferredModel = RESPONSE_MODEL_PRIORITY.find((model) =>
    availableSet.has(model),
  );
  if (preferredModel) return preferredModel;
  return (
    availableModels.find((model) => isResponseModelName(model)) ||
    RESPONSE_MODEL_PRIORITY[0]
  );
};

const safeReadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const resolveMimeType = (format) => {
  switch (String(format || '').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
};

const isCompressionSupported = (format) => ['jpeg', 'webp'].includes(format);

const resolveFormSize = (form) => {
  if (form.size !== CUSTOM_SIZE_VALUE) return form.size;
  return `${form.customWidth}x${form.customHeight}`;
};

const base64ToDataUrl = (base64, format) => {
  if (String(base64 || '').startsWith('data:')) return base64;
  return `data:${resolveMimeType(format)};base64,${base64}`;
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

const resolveImageMimeType = (url, fallback) => {
  const dataMatch = String(url).match(/^data:([^;]+);/);
  if (dataMatch) return dataMatch[1];
  if (/\.jpe?g($|[?#])/i.test(url)) return 'image/jpeg';
  if (/\.webp($|[?#])/i.test(url)) return 'image/webp';
  if (/\.png($|[?#])/i.test(url)) return 'image/png';
  return fallback;
};

const getImageExtension = (url, mimeType) => {
  if (/\.jpe?g($|[?#])/i.test(url) || mimeType === 'image/jpeg') return 'jpg';
  if (/\.webp($|[?#])/i.test(url) || mimeType === 'image/webp') return 'webp';
  return 'png';
};

const buildImageFileName = (index, url, mimeType) => {
  const extension = getImageExtension(url, mimeType);
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  return `generated-${timestamp}-${index + 1}.${extension}`;
};

const normalizeResponseImages = (response, requestedFormat) => {
  const format = response?.output_format || requestedFormat || 'png';
  const mimeType = resolveMimeType(format);
  return (response?.data || [])
    .map((item, index) => {
      const url =
        item.url ||
        (item.b64_json ? `data:${mimeType};base64,${item.b64_json}` : '');
      if (!url) return null;
      const imageMimeType = resolveImageMimeType(url, mimeType);
      return {
        url,
        mimeType: imageMimeType,
        fileName: buildImageFileName(index, url, imageMimeType),
        revisedPrompt: item.revised_prompt || undefined,
      };
    })
    .filter(Boolean);
};

const resolveStreamImageIndex = (payload, fallbackIndex = 0) => {
  const partialImageIndex = normalizeOptionalInteger(
    payload?.partial_image_index,
  );
  if (partialImageIndex !== undefined) return partialImageIndex;
  const imageIndex = normalizeOptionalInteger(payload?.image_index);
  if (imageIndex !== undefined) return imageIndex;
  const outputIndex = normalizeOptionalInteger(payload?.output_index);
  if (outputIndex !== undefined) return outputIndex;
  return fallbackIndex;
};

const walkObject = (value, visitor) => {
  visitor(value);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkObject(item, visitor));
    return;
  }
  Object.values(value).forEach((item) => walkObject(item, visitor));
};

const collectStreamPayloadImages = (
  payload,
  requestedFormat,
  fallbackIndex = 0,
  isPartial = false,
) => {
  if (Array.isArray(payload?.data)) {
    return normalizeResponseImages(payload, requestedFormat).map(
      (image, index) => ({
        ...image,
        isPartial,
        streamIndex: index,
      }),
    );
  }

  const images = [];
  const seenBase64 = new Set();

  walkObject(payload, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;

    const type = String(item.type || '');
    let base64 = '';
    let partial = isPartial;

    if (type === 'image_generation_call' && typeof item.result === 'string') {
      base64 = item.result;
    } else if (
      (type === 'image_generation.completed' ||
        type === 'image_edit.completed') &&
      typeof item.b64_json === 'string'
    ) {
      base64 = item.b64_json;
    } else if (
      type.includes('partial_image') ||
      Object.prototype.hasOwnProperty.call(item, 'partial_image_index')
    ) {
      base64 =
        item.b64_json ||
        item.partial_image_b64 ||
        item.partial_image ||
        item.result ||
        '';
      partial = true;
    }

    if (
      typeof base64 !== 'string' ||
      base64.length <= 100 ||
      seenBase64.has(base64)
    ) {
      return;
    }

    seenBase64.add(base64);
    const streamIndex = resolveStreamImageIndex(
      item,
      fallbackIndex + images.length,
    );
    const url = base64ToDataUrl(base64, requestedFormat);
    const imageMimeType = resolveImageMimeType(
      url,
      resolveMimeType(requestedFormat),
    );
    images.push({
      url,
      mimeType: imageMimeType,
      fileName: buildImageFileName(streamIndex, url, imageMimeType),
      revisedPrompt: item.revised_prompt || item.revisedPrompt || undefined,
      isPartial: partial,
      streamIndex,
    });
  });

  return images;
};

const mergeStreamImages = (currentImages, nextImages) => {
  const merged = [...currentImages];
  nextImages.forEach((nextImage) => {
    const existingIndex = merged.findIndex(
      (image) => image.streamIndex === nextImage.streamIndex,
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...nextImage };
      return;
    }
    merged.push(nextImage);
  });

  return merged.sort(
    (left, right) => (left.streamIndex ?? 0) - (right.streamIndex ?? 0),
  );
};

const stripRuntimeImageFields = (images) =>
  images.map(({ streamIndex, ...image }) => image);

const omitPartialImages = (value) => {
  if (!value || typeof value !== 'object') return {};
  const { partialImages: _partialImages, ...rest } = value;
  return rest;
};

const parseImageApiResponse = async (response) => {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      data?.raw ||
      `请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
};

const consumeStreamImageResponse = async (
  response,
  requestedFormat,
  onProgress,
) => {
  if (!response.ok) {
    await parseImageApiResponse(response);
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentImages = [];

  const emitProgress = () => {
    onProgress?.(stripRuntimeImageFields(currentImages));
  };

  const processEventBlock = (block) => {
    let eventName = '';
    const dataLines = [];

    block.split('\n').forEach((rawLine) => {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(':')) return;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        return;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    const dataText = dataLines.join('\n').trim();
    if (!dataText || dataText === '[DONE]') return;

    let payload = null;
    try {
      payload = JSON.parse(dataText);
    } catch {
      return;
    }

    if (payload?.error?.message) {
      throw new Error(payload.error.message);
    }

    const eventType = payload?.type || eventName;
    if (payload?.response?.error?.message) {
      throw new Error(payload.response.error.message);
    }
    if (eventType === 'error' || eventType?.endsWith('failed')) {
      throw new Error(
        payload?.message ||
          payload?.response?.error?.message ||
          payload?.error?.message ||
          '生成失败',
      );
    }

    if (eventType?.includes('partial_image')) {
      currentImages = mergeStreamImages(
        currentImages,
        collectStreamPayloadImages(
          payload,
          requestedFormat,
          currentImages.length,
          true,
        ),
      );
      emitProgress();
      return;
    }

    const images = collectStreamPayloadImages(
      payload,
      requestedFormat,
      currentImages.length,
      false,
    );
    if (images.length > 0) {
      currentImages = mergeStreamImages(currentImages, images);
      emitProgress();
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const normalizedBuffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalizedBuffer.split('\n\n');
    buffer = done ? '' : blocks.pop() || '';

    blocks.forEach(processEventBlock);

    if (done) {
      if (buffer.trim()) {
        processEventBlock(buffer);
      }
      break;
    }
  }

  if (currentImages.length === 0) {
    throw new Error('接口成功返回，但没有可展示的图片');
  }

  return stripRuntimeImageFields(
    currentImages.map((image) => ({ ...image, isPartial: false })),
  );
};

const maskTokenKey = (key) => {
  const value = String(key || '').trim();
  if (!value) return '******';
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
};

const formatTokenOptionLabel = (token) =>
  `${token.name || `#${token.id}`}(${maskTokenKey(token.key)})`;

const normalizeStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const normalizeOpenAIGroupInfo = (data) => ({
  groups: new Set(normalizeStringList(data?.groups)),
  autoGroups: normalizeStringList(data?.auto_groups),
  userGroup: String(data?.user_group || '').trim(),
});

const tokenHasOpenAIGroup = (token, groupInfo) => {
  if (!token || groupInfo.groups.size === 0) return false;

  const tokenGroups = String(token.group || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
  const groups = tokenGroups.length > 0 ? tokenGroups : [groupInfo.userGroup];

  return groups.some((group) => {
    if (group === 'auto') {
      return groupInfo.autoGroups.some((autoGroup) =>
        groupInfo.groups.has(autoGroup),
      );
    }
    return groupInfo.groups.has(group);
  });
};

const sanitizeHistoryImages = (images) =>
  (Array.isArray(images) ? images : [])
    .filter(
      (image) => image && typeof image.url === 'string' && !image.isPartial,
    )
    .slice(0, 1)
    .map(
      ({ isPartial: _isPartial, streamIndex: _streamIndex, ...image }) => image,
    );

const buildHistoryEntry = (form, images) => {
  const results = sanitizeHistoryImages(images);
  return {
    id: `${Date.now()}-${results.length}`,
    version: 2,
    savedAt: new Date().toISOString(),
    prompt: typeof form.prompt === 'string' ? form.prompt : '',
    results,
  };
};

const normalizeHistoryEntry = (entry) => {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    typeof entry.savedAt !== 'string'
  ) {
    return null;
  }

  const results = sanitizeHistoryImages(entry.results);
  if (results.length === 0) return null;

  if (entry.version === 2) {
    return {
      id: entry.id,
      version: 2,
      savedAt: entry.savedAt,
      prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
      results,
    };
  }

  if (entry.version === 1 && entry.form) {
    return {
      id: entry.id,
      version: 2,
      savedAt: entry.savedAt,
      prompt: typeof entry.form.prompt === 'string' ? entry.form.prompt : '',
      results,
    };
  }

  return null;
};

const normalizeHistoryEntries = (entries, limit = HISTORY_LIMIT) => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(normalizeHistoryEntry)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, limit);
};

const readLegacyHistory = () => {
  const entries = safeReadJson(HISTORY_STORAGE_KEY, []);
  return normalizeHistoryEntries(entries);
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionToPromise = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const openHistoryDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readHistoryEntries = async (limit = HISTORY_LIMIT) => {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(HISTORY_STORE_NAME, 'readonly');
    const transactionDone = transactionToPromise(transaction);
    const store = transaction.objectStore(HISTORY_STORE_NAME);
    const entries = await requestToPromise(store.getAll());
    await transactionDone;
    return normalizeHistoryEntries(entries, limit);
  } finally {
    db.close();
  }
};

const importHistoryEntries = async (entries) => {
  const normalizedEntries = normalizeHistoryEntries(entries);
  if (normalizedEntries.length === 0) return [];

  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE_NAME);
    normalizedEntries.forEach((entry) => store.put(entry));
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }

  return readHistoryEntries();
};

const saveHistoryEntryToDb = async (entry) => {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE_NAME);
    store.put(entry);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }

  const allEntries = await readHistoryEntries(Number.MAX_SAFE_INTEGER);
  const overflowEntries = allEntries.slice(HISTORY_LIMIT);
  if (overflowEntries.length > 0) {
    const cleanupDb = await openHistoryDb();
    try {
      const transaction = cleanupDb.transaction(HISTORY_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(HISTORY_STORE_NAME);
      overflowEntries.forEach((overflowEntry) => store.delete(overflowEntry.id));
      await transactionToPromise(transaction);
    } finally {
      cleanupDb.close();
    }
  }

  return allEntries.slice(0, HISTORY_LIMIT);
};

const clearHistoryEntries = async () => {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    transaction.objectStore(HISTORY_STORE_NAME).clear();
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
};

const extractPagedItems = (payload) =>
  Array.isArray(payload) ? payload : payload?.items || [];

const useObjectUrls = (files) => {
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    const nextUrls = files.map((file) => URL.createObjectURL(file));
    setUrls(nextUrls);
    return () => {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  return urls;
};

const ImageGeneration = () => {
  const { t } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const drawingEnabled = isDrawingEnabledFromStatus(statusState?.status);

  const savedForm = useMemo(() => {
    const restForm = omitPartialImages(safeReadJson(FORM_STORAGE_KEY, {}));
    const restFormWithoutCount = { ...restForm };
    delete restFormWithoutCount.count;
    delete restFormWithoutCount.moderation;
    const normalizedForm = {
      ...restFormWithoutCount,
      outputCompression: normalizeOptionalInteger(
        restFormWithoutCount.outputCompression,
      ),
    };
    if (!normalizedForm.responseModel)
      normalizedForm.responseModel = DEFAULT_FORM.responseModel;
    if (!normalizedForm.quality) normalizedForm.quality = DEFAULT_FORM.quality;
    if (!normalizedForm.background)
      normalizedForm.background = DEFAULT_FORM.background;
    if (!normalizedForm.outputFormat)
      normalizedForm.outputFormat = DEFAULT_FORM.outputFormat;
    if (!SIZE_OPTIONS.some((option) => option.value === normalizedForm.size)) {
      normalizedForm.size = DEFAULT_FORM.size;
    }
    normalizedForm.customWidth =
      normalizeOptionalInteger(normalizedForm.customWidth) ||
      DEFAULT_FORM.customWidth;
    normalizedForm.customHeight =
      normalizeOptionalInteger(normalizedForm.customHeight) ||
      DEFAULT_FORM.customHeight;
    return normalizedForm;
  }, []);
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...savedForm });
  const [tokens, setTokens] = useState([]);
  const [models, setModels] = useState([]);
  const [responseModels, setResponseModels] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [sourceFiles, setSourceFiles] = useState([]);
  const sourcePreviewUrls = useObjectUrls(sourceFiles);
  const [resultImages, setResultImages] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState('');
  const [restoredFromHistory, setRestoredFromHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewDragging, setPreviewDragging] = useState(false);
  const [maskTool, setMaskTool] = useState('brush');
  const [brushSize, setBrushSize] = useState(44);
  const [maskReady, setMaskReady] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [maskExpanded, setMaskExpanded] = useState(false);
  const [settingsPanelRePosKey, setSettingsPanelRePosKey] = useState(0);

  const abortControllerRef = useRef(null);
  const sourceInputRef = useRef(null);
  const previewViewportRef = useRef(null);
  const previewDragStateRef = useRef(null);
  const maskBaseCanvasRef = useRef(null);
  const maskPaintCanvasRef = useRef(null);
  const maskPointerDownRef = useRef(false);
  const maskStartPointRef = useRef(null);
  const maskLastPointRef = useRef(null);
  const maskShapeSnapshotRef = useRef(null);
  const maskUndoStackRef = useRef([]);

  const availableModelValues = useMemo(
    () =>
      models.filter((option) => !option.disabled).map((option) => option.value),
    [models],
  );

  const availableResponseModelValues = useMemo(
    () =>
      responseModels
        .filter((option) => !option.disabled)
        .map((option) => option.value),
    [responseModels],
  );

  const tokenOptions = useMemo(
    () =>
      tokens.map((token) => ({
        label: formatTokenOptionLabel(token),
        value: String(token.id),
      })),
    [tokens],
  );

  const sizeOptions = useMemo(
    () => SIZE_OPTIONS.map((option) => ({ ...option, label: t(option.label) })),
    [t],
  );

  const qualityOptions = useMemo(
    () =>
      QUALITY_OPTIONS.map((option) => ({ ...option, label: t(option.label) })),
    [t],
  );

  const backgroundOptions = useMemo(
    () =>
      BACKGROUND_OPTIONS.map((option) => ({
        ...option,
        label: t(option.label),
        disabled:
          form.model === 'gpt-image-2' && option.value === 'transparent',
      })),
    [form.model, t],
  );

  const outputFormatOptions = useMemo(
    () =>
      OUTPUT_FORMAT_OPTIONS.map((option) => ({
        ...option,
        label: t(option.label),
      })),
    [t],
  );

  const updateForm = useCallback((patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleImageModelChange = useCallback(
    (model) => {
      const patch = { model };
      if (model === 'gpt-image-2' && form.background === 'transparent') {
        patch.background = 'auto';
        Toast.warning(t('gpt-image-2 不支持透明背景，已切换为自动'));
      }
      updateForm(patch);
    },
    [form.background, t, updateForm],
  );

  const resetMaskCanvas = useCallback(() => {
    const baseCanvas = maskBaseCanvasRef.current;
    const paintCanvas = maskPaintCanvasRef.current;
    if (baseCanvas) {
      const context = baseCanvas.getContext('2d');
      context?.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      baseCanvas.width = 0;
      baseCanvas.height = 0;
    }
    if (paintCanvas) {
      const context = paintCanvas.getContext('2d');
      context?.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
      paintCanvas.width = 0;
      paintCanvas.height = 0;
    }
    maskUndoStackRef.current = [];
    setMaskReady(false);
    setHasMask(false);
  }, []);

  const clearSourceFiles = useCallback(() => {
    setSourceFiles([]);
    if (sourceInputRef.current) sourceInputRef.current.value = '';
    resetMaskCanvas();
  }, [resetMaskCanvas]);

  const loadMaskEditorImage = useCallback(
    (file) => {
      const baseCanvas = maskBaseCanvasRef.current;
      const paintCanvas = maskPaintCanvasRef.current;
      if (!baseCanvas || !paintCanvas || !file) return;

      const objectUrl = URL.createObjectURL(file);
      const image = new window.Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        baseCanvas.width = width;
        baseCanvas.height = height;
        paintCanvas.width = width;
        paintCanvas.height = height;

        const baseContext = baseCanvas.getContext('2d');
        const paintContext = paintCanvas.getContext('2d', {
          willReadFrequently: true,
        });
        baseContext.clearRect(0, 0, width, height);
        paintContext.clearRect(0, 0, width, height);
        baseContext.drawImage(image, 0, 0, width, height);
        maskUndoStackRef.current = [];
        setMaskReady(true);
        setHasMask(false);
        URL.revokeObjectURL(objectUrl);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resetMaskCanvas();
        Toast.error(t('源图加载失败'));
      };
      image.src = objectUrl;
    },
    [resetMaskCanvas, t],
  );

  useEffect(() => {
    if (form.mode === MODE_MASK && sourceFiles.length === 1) {
      loadMaskEditorImage(sourceFiles[0]);
    } else {
      resetMaskCanvas();
    }
  }, [form.mode, sourceFiles, loadMaskEditorImage, resetMaskCanvas]);

  useEffect(() => {
    let mounted = true;

    const loadHistory = async () => {
      try {
        const legacyEntries = readLegacyHistory();
        if (legacyEntries.length > 0) {
          const importedEntries = await importHistoryEntries(legacyEntries);
          localStorage.removeItem(HISTORY_STORAGE_KEY);
          if (mounted) {
            setHistoryEntries(importedEntries);
            return;
          }
        }

        const entries = await readHistoryEntries();
        if (mounted) {
          setHistoryEntries(entries);
        }
      } catch {
        if (mounted) {
          setHistoryEntries([]);
        }
      }
    };

    loadHistory();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const formToSave = omitPartialImages(form);
    delete formToSave.count;
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formToSave));
  }, [form]);

  useEffect(() => {
    const loadMeta = async () => {
      if (!drawingEnabled) return;
      setLoadingMeta(true);
      try {
        const loadAllTokens = async () => {
          let page = 1;
          let allTokens = [];

          while (true) {
            const tokenRes = await API.get(
              `/api/token/?p=${page}&size=${TOKEN_PAGE_SIZE}`,
            );
            const { success, message, data } = tokenRes.data || {};
            if (!success) {
              throw new Error(message || t('加载生图配置失败'));
            }

            const pageItems = extractPagedItems(data);
            allTokens = allTokens.concat(pageItems);

            const total = Number(Array.isArray(data) ? 0 : data?.total || 0);
            if (pageItems.length === 0) break;
            if (total > 0 && allTokens.length >= total) break;
            if (pageItems.length < TOKEN_PAGE_SIZE) break;

            page += 1;
          }

          return allTokens.filter((token) => token.status === 1);
        };

        const [activeTokens, modelRes, openAIGroupRes] = await Promise.all([
          loadAllTokens(),
          API.get('/api/user/models'),
          API.get('/api/user/self/openai-groups'),
        ]);

        const {
          success: modelSuccess,
          message: modelMessage,
          data: modelData,
        } = modelRes.data || {};
        if (!modelSuccess) {
          throw new Error(modelMessage || t('加载生图配置失败'));
        }

        const {
          success: openAIGroupSuccess,
          message: openAIGroupMessage,
          data: openAIGroupData,
        } = openAIGroupRes.data || {};
        if (!openAIGroupSuccess) {
          throw new Error(openAIGroupMessage || t('加载生图配置失败'));
        }

        const openAIGroupInfo = normalizeOpenAIGroupInfo(openAIGroupData);
        const openAITokens = activeTokens.filter((token) =>
          tokenHasOpenAIGroup(token, openAIGroupInfo),
        );
        setTokens(openAITokens);

        const userModels = Array.isArray(modelData) ? modelData : [];
        const usableModels = SUPPORTED_IMAGE_MODELS.filter((model) =>
          userModels.includes(model),
        );
        const preferredResponseModels = RESPONSE_MODEL_PRIORITY.filter(
          (model) => userModels.includes(model),
        );
        const fallbackResponseModels = userModels.filter(
          (model) =>
            isResponseModelName(model) &&
            !preferredResponseModels.includes(model),
        );
        const usableResponseModels = [
          ...preferredResponseModels,
          ...fallbackResponseModels,
        ];
        const nextModels = SUPPORTED_IMAGE_MODELS.map((model) => ({
          label: usableModels.includes(model)
            ? model
            : `${model}（${t('未在可用模型中')}）`,
          value: model,
          disabled: !usableModels.includes(model),
        }));
        const nextResponseModels =
          usableResponseModels.length > 0
            ? usableResponseModels.map((model) => ({
                label: model,
                value: model,
              }))
            : RESPONSE_MODEL_PRIORITY.map((model) => ({
                label: `${model}（${t('未在可用模型中')}）`,
                value: model,
                disabled: true,
              }));
        setModels(nextModels);
        setResponseModels(nextResponseModels);

        setForm((prev) => {
          const tokenId =
            prev.tokenId &&
            openAITokens.some(
              (token) => String(token.id) === String(prev.tokenId),
            )
              ? String(prev.tokenId)
              : openAITokens[0]?.id
                ? String(openAITokens[0].id)
                : undefined;
          const validModel = usableModels.includes(prev.model)
            ? prev.model
            : getBestModel(usableModels);
          const validResponseModel = usableResponseModels.includes(
            prev.responseModel,
          )
            ? prev.responseModel
            : getBestResponseModel(usableResponseModels);
          return {
            ...prev,
            tokenId,
            model: validModel,
            responseModel: validResponseModel,
          };
        });
      } catch (error) {
        Toast.error(t('加载生图配置失败'));
      } finally {
        setLoadingMeta(false);
      }
    };

    loadMeta();
  }, [drawingEnabled, t]);

  const handleModeChange = useCallback(
    (mode) => {
      updateForm({ mode });
      if (mode === MODE_GENERATE) {
        clearSourceFiles();
      } else if (mode === MODE_MASK && sourceFiles.length > 1) {
        setSourceFiles(sourceFiles.slice(0, 1));
        Toast.warning(t('遮罩模式只能使用一张源图，已保留第一张'));
      }
    },
    [clearSourceFiles, sourceFiles, t, updateForm],
  );

  const handleSourceFilesChange = useCallback(
    (event) => {
      const files = Array.from(event.target.files || []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (form.mode === MODE_MASK && files.length > 1) {
        Toast.warning(t('遮罩模式只能使用一张源图，已保留第一张'));
      }
      setSourceFiles(form.mode === MODE_MASK ? files.slice(0, 1) : files);
    },
    [form.mode, t],
  );

  useEffect(() => {
    if (form.model === 'gpt-image-2' && form.background === 'transparent') {
      updateForm({ background: 'auto' });
    }
  }, [form.background, form.model, updateForm]);

  const getCanvasPoint = useCallback((event) => {
    const canvas = maskPaintCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const pushMaskUndo = useCallback(() => {
    const canvas = maskPaintCanvasRef.current;
    if (!canvas || !maskReady) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    maskUndoStackRef.current.push(
      context.getImageData(0, 0, canvas.width, canvas.height),
    );
    if (maskUndoStackRef.current.length > 20) maskUndoStackRef.current.shift();
  }, [maskReady]);

  const drawMaskLine = useCallback(
    (from, to, erase) => {
      const canvas = maskPaintCanvasRef.current;
      const context = canvas.getContext('2d');
      context.save();
      context.globalCompositeOperation = erase
        ? 'destination-out'
        : 'source-over';
      context.strokeStyle = '#ff2d55';
      context.fillStyle = '#ff2d55';
      context.lineWidth = brushSize;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.beginPath();
      context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      setHasMask(true);
    },
    [brushSize],
  );

  const drawMaskShape = useCallback((start, end, shape) => {
    const canvas = maskPaintCanvasRef.current;
    const context = canvas.getContext('2d');
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(start.x - end.x);
    const height = Math.abs(start.y - end.y);
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#ff2d55';
    context.beginPath();
    if (shape === 'circle') {
      context.ellipse(
        x + width / 2,
        y + height / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else {
      context.fillRect(x, y, width, height);
    }
    context.restore();
    if (width > 0 && height > 0) setHasMask(true);
  }, []);

  const handleMaskPointerDown = useCallback(
    (event) => {
      if (!maskReady) return;
      event.preventDefault();
      const canvas = maskPaintCanvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const point = getCanvasPoint(event);
      pushMaskUndo();
      maskPointerDownRef.current = true;
      maskStartPointRef.current = point;
      maskLastPointRef.current = point;

      if (maskTool === 'circle' || maskTool === 'rect') {
        maskShapeSnapshotRef.current = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
      } else {
        drawMaskLine(point, point, maskTool === 'eraser');
      }
    },
    [drawMaskLine, getCanvasPoint, maskReady, maskTool, pushMaskUndo],
  );

  const handleMaskPointerMove = useCallback(
    (event) => {
      if (!maskPointerDownRef.current || !maskReady) return;
      event.preventDefault();
      const point = getCanvasPoint(event);
      const canvas = maskPaintCanvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (maskTool === 'circle' || maskTool === 'rect') {
        if (maskShapeSnapshotRef.current) {
          context.putImageData(maskShapeSnapshotRef.current, 0, 0);
          drawMaskShape(maskStartPointRef.current, point, maskTool);
        }
      } else {
        drawMaskLine(maskLastPointRef.current, point, maskTool === 'eraser');
        maskLastPointRef.current = point;
      }
    },
    [drawMaskLine, drawMaskShape, getCanvasPoint, maskReady, maskTool],
  );

  const handleMaskPointerUp = useCallback(
    (event) => {
      if (!maskPointerDownRef.current) return;
      event.preventDefault();
      if (maskTool === 'circle' || maskTool === 'rect') {
        const point = getCanvasPoint(event);
        const canvas = maskPaintCanvasRef.current;
        const context = canvas.getContext('2d');
        if (maskShapeSnapshotRef.current)
          context.putImageData(maskShapeSnapshotRef.current, 0, 0);
        drawMaskShape(maskStartPointRef.current, point, maskTool);
      }
      maskPointerDownRef.current = false;
      maskShapeSnapshotRef.current = null;
    },
    [drawMaskShape, getCanvasPoint, maskTool],
  );

  const undoMaskAction = useCallback(() => {
    const previous = maskUndoStackRef.current.pop();
    const canvas = maskPaintCanvasRef.current;
    if (!previous || !canvas) return;
    canvas.getContext('2d').putImageData(previous, 0, 0);
    setHasMask(maskUndoStackRef.current.length > 0);
  }, []);

  const clearMaskCanvas = useCallback(() => {
    const canvas = maskPaintCanvasRef.current;
    if (!canvas || !maskReady) return;
    pushMaskUndo();
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasMask(false);
  }, [maskReady, pushMaskUndo]);

  const buildMaskCanvas = useCallback(() => {
    const paintCanvas = maskPaintCanvasRef.current;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = paintCanvas.width;
    maskCanvas.height = paintCanvas.height;
    const context = maskCanvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(paintCanvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    return maskCanvas;
  }, []);

  const maskHasPixels = useCallback(() => {
    const canvas = maskPaintCanvasRef.current;
    if (!canvas || !maskReady || canvas.width === 0 || canvas.height === 0)
      return false;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
    for (let index = 3; index < imageData.length; index += 4) {
      if (imageData[index] > 0) return true;
    }
    return false;
  }, [maskReady]);

  const createMaskDataUrl = useCallback(() => {
    const maskCanvas = buildMaskCanvas();
    return maskCanvas.toDataURL('image/png');
  }, [buildMaskCanvas]);

  const validateBeforeSubmit = useCallback(() => {
    if (!drawingEnabled) throw new Error(t('绘图功能未启用'));
    if (!form.tokenId) throw new Error(t('请选择 API Key'));
    if (!form.responseModel) throw new Error(t('请选择 Responses 模型'));
    if (!availableResponseModelValues.includes(form.responseModel)) {
      throw new Error(t('当前用户不可用该 Responses 模型'));
    }
    if (!SUPPORTED_IMAGE_MODELS.includes(form.model))
      throw new Error(t('当前仅支持 gpt-image-1、gpt-image-1.5、gpt-image-2'));
    if (!availableModelValues.includes(form.model)) {
      throw new Error(t('当前用户不可用该模型'));
    }
    if (!form.prompt.trim()) throw new Error(t('请输入提示词'));
    if (form.mode === MODE_EDIT && sourceFiles.length === 0)
      throw new Error(t('请先上传源图'));
    if (form.mode === MODE_MASK) {
      if (sourceFiles.length !== 1)
        throw new Error(t('遮罩模式需要且只能上传一张源图'));
      if (!maskHasPixels()) throw new Error(t('请先在源图上绘制遮罩区域'));
    }
    if (form.model === 'gpt-image-2' && form.background === 'transparent') {
      throw new Error(t('gpt-image-2 不支持透明背景'));
    }
    if (form.size === CUSTOM_SIZE_VALUE) {
      const width = Number(form.customWidth);
      const height = Number(form.customHeight);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error(t('请输入有效的自定义宽高'));
      }

      const longEdge = Math.max(width, height);
      const shortEdge = Math.min(width, height);
      const pixels = width * height;

      if (longEdge > CUSTOM_SIZE_LIMITS.maxEdge) {
        throw new Error(t('自定义尺寸最大边长不能超过 3840px'));
      }
      if (
        width % CUSTOM_SIZE_LIMITS.step !== 0 ||
        height % CUSTOM_SIZE_LIMITS.step !== 0
      ) {
        throw new Error(t('自定义尺寸的宽高都必须是 16px 的倍数'));
      }
      if (longEdge / shortEdge > CUSTOM_SIZE_LIMITS.maxRatio) {
        throw new Error(t('自定义尺寸的长边与短边比例不能超过 3:1'));
      }
      if (
        pixels < CUSTOM_SIZE_LIMITS.minPixels ||
        pixels > CUSTOM_SIZE_LIMITS.maxPixels
      ) {
        throw new Error(
          t('自定义尺寸总像素数必须在 655,360 到 8,294,400 之间'),
        );
      }
    }
    if (
      form.outputCompression !== undefined &&
      form.outputCompression !== null &&
      (!Number.isFinite(form.outputCompression) ||
        form.outputCompression < 0 ||
        form.outputCompression > 100)
    ) {
      throw new Error(t('输出压缩需要在 0 到 100 之间'));
    }
  }, [
    availableModelValues,
    availableResponseModelValues,
    drawingEnabled,
    form,
    maskHasPixels,
    sourceFiles.length,
    t,
  ]);

  const buildResponsesPayload = useCallback(async () => {
    const content = [{ type: 'input_text', text: form.prompt.trim() }];
    const filesToSend =
      form.mode === MODE_MASK ? sourceFiles.slice(0, 1) : sourceFiles;

    if (form.mode !== MODE_GENERATE) {
      for (const file of filesToSend) {
        content.push({
          type: 'input_image',
          image_url: await fileToDataUrl(file),
          detail: 'auto',
        });
      }
    }

    const outputFormat = form.outputFormat || 'png';
    const tool = {
      type: 'image_generation',
      model: form.model,
      action: form.mode === MODE_GENERATE ? 'generate' : 'edit',
      size: resolveFormSize(form),
      quality: form.quality || 'auto',
      output_format: outputFormat,
      background: form.background || 'auto',
      moderation: 'low',
      partial_images: 0,
    };

    if (
      isCompressionSupported(outputFormat) &&
      Number.isFinite(form.outputCompression)
    ) {
      tool.output_compression = form.outputCompression;
    }

    if (form.mode === MODE_MASK) {
      tool.input_image_mask = { image_url: createMaskDataUrl() };
    }

    return {
      model: form.responseModel,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      tools: [tool],
      tool_choice: { type: 'image_generation' },
      store: false,
      stream: true,
    };
  }, [createMaskDataUrl, form, sourceFiles]);

  const requestImageGeneration = useCallback(
    async (apiKey, signal, onProgress) => {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'New-Api-User': getUserIdFromLocalStorage(),
      };

      const response = await fetch('/v1/responses', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(await buildResponsesPayload()),
        signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        if (!response.ok) {
          await parseImageApiResponse(response);
        }
        throw new Error(t('接口未返回流式响应'));
      }
      return consumeStreamImageResponse(
        response,
        form.outputFormat,
        onProgress,
      );
    },
    [buildResponsesPayload, form.outputFormat, t],
  );

  const saveHistoryEntry = useCallback(async (entry) => {
    try {
      const next = await saveHistoryEntryToDb(entry);
      setHistoryEntries(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    try {
      validateBeforeSubmit();
    } catch (error) {
      Toast.error(error.message);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setActiveHistoryId('');
    setRestoredFromHistory(false);
    setResultImages([]);
    abortControllerRef.current = new AbortController();

    try {
      const key = normalizeKey(await fetchTokenKey(form.tokenId));
      const images = await requestImageGeneration(
        key,
        abortControllerRef.current.signal,
        (streamImages) => {
          setResultImages(streamImages);
        },
      );
      const entry = buildHistoryEntry(form, images);
      if (entry.results.length === 0) {
        throw new Error(t('接口成功返回，但没有可展示的图片'));
      }
      setResultImages(entry.results);
      const saved = await saveHistoryEntry(entry);
      setActiveHistoryId(entry.id);
      Toast.success(
        saved ? t('生成成功，已保存到历史记录') : t('生成成功，但历史保存失败'),
      );
    } catch (error) {
      const message =
        error.name === 'AbortError' ? t('请求已取消') : error.message;
      setSubmitError(message);
      Toast.error(message);
    } finally {
      setSubmitting(false);
      abortControllerRef.current = null;
    }
  }, [
    form,
    requestImageGeneration,
    saveHistoryEntry,
    submitting,
    t,
    validateBeforeSubmit,
  ]);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const resetPreviewZoom = useCallback(() => {
    setPreviewZoom(1);
    setPreviewDragging(false);
    previewDragStateRef.current = null;
    requestAnimationFrame(() => {
      const viewport = previewViewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  }, []);

  useEffect(() => {
    resetPreviewZoom();
  }, [previewImage?.url, resetPreviewZoom]);

  const handlePreviewWheel = useCallback((event) => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const scrollRatioX =
      viewport.scrollWidth > 0
        ? (viewport.scrollLeft + pointerX) / viewport.scrollWidth
        : 0;
    const scrollRatioY =
      viewport.scrollHeight > 0
        ? (viewport.scrollTop + pointerY) / viewport.scrollHeight
        : 0;

    const normalizedDelta = Math.max(-4, Math.min(4, event.deltaY / 100));
    const zoomFactor = Math.pow(1.12, -normalizedDelta);
    setPreviewZoom((prev) => {
      const next = Math.min(
        6,
        Math.max(0.2, Number((prev * zoomFactor).toFixed(2))),
      );
      requestAnimationFrame(() => {
        const nextViewport = previewViewportRef.current;
        if (!nextViewport) return;
        nextViewport.scrollLeft =
          scrollRatioX * nextViewport.scrollWidth - pointerX;
        nextViewport.scrollTop =
          scrollRatioY * nextViewport.scrollHeight - pointerY;
      });
      return next;
    });
  }, []);

  const handlePreviewMouseDown = useCallback(
    (event) => {
      if (event.button !== 0 || previewZoom <= 1) return;
      const viewport = previewViewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      previewDragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      setPreviewDragging(true);
    },
    [previewZoom],
  );

  const stopPreviewDrag = useCallback(() => {
    previewDragStateRef.current = null;
    setPreviewDragging(false);
  }, []);

  const handlePreviewMouseMove = useCallback(
    (event) => {
      const dragState = previewDragStateRef.current;
      const viewport = previewViewportRef.current;
      if (!dragState || !viewport) return;
      event.preventDefault();
      viewport.scrollLeft =
        dragState.scrollLeft - (event.clientX - dragState.startX);
      viewport.scrollTop =
        dragState.scrollTop - (event.clientY - dragState.startY);
    },
    [],
  );

  useEffect(() => {
    if (!previewDragging) return undefined;

    window.addEventListener('mousemove', handlePreviewMouseMove);
    window.addEventListener('mouseup', stopPreviewDrag);
    return () => {
      window.removeEventListener('mousemove', handlePreviewMouseMove);
      window.removeEventListener('mouseup', stopPreviewDrag);
    };
  }, [handlePreviewMouseMove, previewDragging, stopPreviewDrag]);

  const restoreHistoryEntry = useCallback(
    (entry) => {
      const results = sanitizeHistoryImages(entry.results);
      setForm((prev) => ({ ...prev, prompt: entry.prompt || '' }));
      setResultImages(results);
      setSubmitError('');
      setActiveHistoryId(entry.id);
      setRestoredFromHistory(true);
      clearSourceFiles();
      Toast.success(t('已恢复历史记录'));
    },
    [clearSourceFiles, t],
  );

  const clearHistory = useCallback(() => {
    Modal.confirm({
      title: t('确认清空历史记录？'),
      content: t('历史记录仅保存在当前浏览器，清空后不可恢复。'),
      okType: 'danger',
      onOk: async () => {
        await clearHistoryEntries();
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        setHistoryEntries([]);
        setResultImages([]);
        setActiveHistoryId('');
        setRestoredFromHistory(false);
      },
    });
  }, [t]);

  const resetForm = useCallback(() => {
    setForm((prev) => ({
      ...DEFAULT_FORM,
      tokenId: prev.tokenId,
      responseModel: getBestResponseModel(availableResponseModelValues),
      model: getBestModel(availableModelValues),
    }));
    setSubmitError('');
    setRestoredFromHistory(false);
    clearSourceFiles();
  }, [availableModelValues, availableResponseModelValues, clearSourceFiles]);

  const copyImageLink = useCallback(
    async (image) => {
      if (await copy(image.url)) Toast.success(t('图片链接已复制'));
    },
    [t],
  );

  const copyAllImageLinks = useCallback(async () => {
    if (resultImages.length === 0) return;
    if (await copy(resultImages.map((image) => image.url).join('\n'))) {
      Toast.success(t('全部图片链接已复制'));
    }
  }, [resultImages, t]);

  const triggerDownload = useCallback((url, fileName) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const downloadImage = useCallback(
    async (image, options = {}) => {
      if (image.url.startsWith('data:')) {
        triggerDownload(image.url, image.fileName);
        if (!options.silent) Toast.success(t('已开始下载图片'));
        return;
      }

      try {
        const response = await fetch(image.url);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        triggerDownload(objectUrl, image.fileName);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch {
        triggerDownload(image.url, image.fileName);
      }

      if (!options.silent) Toast.success(t('已开始下载图片'));
    },
    [t, triggerDownload],
  );

  const downloadAllImages = useCallback(async () => {
    if (resultImages.length === 0) return;
    for (const image of resultImages) {
      await downloadImage(image, { silent: true });
    }
    Toast.success(t('已开始下载全部图片'));
  }, [downloadImage, resultImages, t]);

  const renderSourceUploader = () => {
    if (form.mode === MODE_GENERATE) return null;
    return (
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <Typography.Text strong>
            {t(form.mode === MODE_MASK ? '源图（仅一张）' : '源图')}
          </Typography.Text>
          {sourceFiles.length > 0 && (
            <Button
              size='small'
              theme='borderless'
              type='danger'
              icon={<Trash2 size={14} />}
              onClick={clearSourceFiles}
            >
              {t('清空')}
            </Button>
          )}
        </div>
        <input
          ref={sourceInputRef}
          type='file'
          accept='image/*'
          multiple={form.mode === MODE_EDIT}
          onChange={handleSourceFilesChange}
          className='block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-semi-color-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90'
        />
        <Typography.Text type='tertiary' size='small'>
          {t(
            form.mode === MODE_MASK
              ? '遮罩模式只使用一张源图，遮罩在页面内绘制生成。'
              : '图生图可上传一张或多张源图。',
          )}
        </Typography.Text>
        {sourcePreviewUrls.length > 0 && (
          <div className='grid grid-cols-3 gap-2'>
            {sourcePreviewUrls.map((url, index) => (
              <button
                key={url}
                type='button'
                className='aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50'
                onClick={() =>
                  setPreviewImage({ url, title: `${t('源图')} ${index + 1}` })
                }
              >
                <img
                  src={url}
                  alt={`${t('源图')} ${index + 1}`}
                  className='h-full w-full object-cover'
                />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderMaskEditor = () => {
    if (form.mode !== MODE_MASK) return null;
    return (
      <>
        <div
          className={`space-y-3 ${
            maskExpanded
              ? 'fixed left-1/2 top-1/2 z-[1100] overflow-auto rounded-2xl border border-gray-200 p-5 shadow-2xl'
              : ''
          }`}
          style={
            maskExpanded
              ? {
                  width: 'min(1080px, calc(100vw - 48px))',
                  maxHeight: 'calc(100vh - 72px)',
                  backgroundColor: 'var(--semi-color-bg-0, #fff)',
                  transform: 'translate(-50%, -50%)',
                }
              : undefined
          }
        >
          <div className='flex items-start justify-between gap-3'>
            <div>
              <Typography.Text strong>{t('遮罩编辑器')}</Typography.Text>
              <div className='mt-1 text-xs text-gray-500'>
                {t(
                  '红色标记表示要修改的区域，提交时会自动生成透明编辑区域的 PNG mask。',
                )}
              </div>
            </div>
            {maskExpanded && (
              <Button
                icon={<X size={16} />}
                onClick={() => setMaskExpanded(false)}
                theme='borderless'
                type='tertiary'
                size='small'
              />
            )}
          </div>
          <div className='flex flex-wrap gap-2'>
            {MASK_TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <Button
                  key={tool.key}
                  size='small'
                  theme={maskTool === tool.key ? 'solid' : 'light'}
                  type={maskTool === tool.key ? 'primary' : 'tertiary'}
                  icon={<Icon size={14} />}
                  onClick={() => setMaskTool(tool.key)}
                >
                  {t(tool.label)}
                </Button>
              );
            })}
          </div>
          <div className='flex items-center gap-3'>
            <input
              type='range'
              min='4'
              max='180'
              step='2'
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              className='flex-1'
            />
            <Tag color='blue'>{brushSize}px</Tag>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              size='small'
              theme='light'
              icon={<Undo2 size={14} />}
              onClick={undoMaskAction}
              disabled={!maskReady}
            >
              {t('撤销')}
            </Button>
            <Button
              size='small'
              theme='light'
              icon={<Trash2 size={14} />}
              onClick={clearMaskCanvas}
              disabled={!maskReady}
            >
              {t('清空遮罩')}
            </Button>
            {!maskExpanded && (
              <Button
                size='small'
                type='primary'
                theme='light'
                icon={<Maximize2 size={14} />}
                onClick={() => setMaskExpanded(true)}
                disabled={!maskReady}
              >
                {t('放大编辑')}
              </Button>
            )}
          </div>
          <div
            className={`relative rounded-2xl border border-dashed border-gray-300 bg-gray-50 ${
              maskExpanded
                ? 'mx-auto max-h-[68vh] max-w-[900px] overflow-auto'
                : 'overflow-hidden'
            }`}
          >
            {!maskReady && (
              <div className='flex aspect-square items-center justify-center px-4 text-center text-sm text-gray-500'>
                {t('上传一张源图后开始绘制遮罩')}
              </div>
            )}
            <div className={maskReady ? 'relative' : 'hidden'}>
              <canvas
                ref={maskBaseCanvasRef}
                className='block h-auto w-full select-none'
              />
              <canvas
                ref={maskPaintCanvasRef}
                className='absolute inset-0 h-full w-full touch-none select-none opacity-70'
                onPointerDown={handleMaskPointerDown}
                onPointerMove={handleMaskPointerMove}
                onPointerUp={handleMaskPointerUp}
                onPointerCancel={handleMaskPointerUp}
              />
            </div>
          </div>
        </div>
        {maskExpanded && (
          <div
            className='fixed inset-0 z-[1099]'
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
            onClick={() => setMaskExpanded(false)}
          />
        )}
      </>
    );
  };

  const renderSettingsPanel = () => (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{
        padding: 24,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className='mb-6 flex items-center justify-between'>
        <div className='flex items-center'>
          <div className='mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-pink-500'>
            <Settings size={20} className='text-white' />
          </div>
          <div>
            <Typography.Title heading={5} className='mb-0'>
              {t('生图设置')}
            </Typography.Title>
            <Typography.Text type='tertiary' size='small'>
              {t('配置提示词和生成参数')}
            </Typography.Text>
          </div>
        </div>
      </div>

      <div
        className='flex-1 space-y-5 overflow-y-auto pr-2 model-settings-scroll'
        onScroll={() => setSettingsPanelRePosKey((prev) => prev + 1)}
      >
        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('API Key')}
          </Typography.Text>
          <Select
            placeholder={t('请选择 API Key')}
            optionList={tokenOptions}
            value={form.tokenId}
            onChange={(value) => updateForm({ tokenId: value })}
            style={{ width: '100%' }}
            filter
            disabled={!drawingEnabled || loadingMeta}
          />
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('Responses 模型')}
          </Typography.Text>
          <Select
            optionList={responseModels}
            value={form.responseModel}
            onChange={(value) => updateForm({ responseModel: value })}
            style={{ width: '100%' }}
            filter
            disabled={!drawingEnabled || loadingMeta}
          />
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('图片模型')}
          </Typography.Text>
          <Select
            optionList={models}
            value={form.model}
            onChange={handleImageModelChange}
            style={{ width: '100%' }}
            disabled={!drawingEnabled || loadingMeta}
          />
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('模式')}
          </Typography.Text>
          <Tabs
            type='button'
            activeKey={form.mode}
            onChange={handleModeChange}
            className='w-full'
          >
            <TabPane tab={t('文生图')} itemKey={MODE_GENERATE} />
            <TabPane tab={t('图生图')} itemKey={MODE_EDIT} />
            <TabPane tab={t('图生图（遮罩）')} itemKey={MODE_MASK} />
          </Tabs>
        </div>

        {renderSourceUploader()}
        {renderMaskEditor()}

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('提示词')}
          </Typography.Text>
          <TextArea
            autosize={{ minRows: 4, maxRows: 8 }}
            placeholder={t('描述你想生成或修改的图片内容')}
            value={form.prompt}
            onChange={(value) => updateForm({ prompt: value })}
            disabled={!drawingEnabled}
          />
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('尺寸')}
          </Typography.Text>
          <Select
            optionList={sizeOptions}
            value={form.size}
            onChange={(value) => updateForm({ size: value })}
            style={{ width: '100%' }}
            disabled={!drawingEnabled}
          />
          {form.size === CUSTOM_SIZE_VALUE && (
            <div className='mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3'>
              <div className='mb-3 flex items-center gap-1'>
                <Typography.Text strong>{t('自定义宽高')}</Typography.Text>
                <Tooltip
                  content={t(
                    'OpenAI 自定义尺寸限制：最大边长 ≤ 3840px；宽高都必须是 16px 的倍数；长边与短边比例 ≤ 3:1；总像素数在 655,360 到 8,294,400 之间。',
                  )}
                  position='top'
                  showArrow
                  rePosKey={settingsPanelRePosKey}
                  getPopupContainer={() => document.body}
                >
                  <IconHelpCircle className='cursor-help text-gray-400' />
                </Tooltip>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <InputNumber
                  min={16}
                  max={3840}
                  step={16}
                  value={form.customWidth}
                  onChange={(value) =>
                    updateForm({ customWidth: normalizeOptionalInteger(value) })
                  }
                  prefix={t('宽')}
                  suffix='px'
                  style={{ width: '100%' }}
                  disabled={!drawingEnabled}
                />
                <InputNumber
                  min={16}
                  max={3840}
                  step={16}
                  value={form.customHeight}
                  onChange={(value) =>
                    updateForm({
                      customHeight: normalizeOptionalInteger(value),
                    })
                  }
                  prefix={t('高')}
                  suffix='px'
                  style={{ width: '100%' }}
                  disabled={!drawingEnabled}
                />
              </div>
            </div>
          )}
        </div>

        <details className='rounded-2xl border border-gray-200 bg-gray-50 p-4'>
          <summary className='cursor-pointer text-sm font-semibold text-gray-700'>
            {t('高级参数')}
          </summary>
          <div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div>
              <Typography.Text strong className='mb-2 block'>
                {t('质量')}
              </Typography.Text>
              <Select
                optionList={qualityOptions}
                value={form.quality}
                onChange={(value) => updateForm({ quality: value })}
                style={{ width: '100%' }}
                disabled={!drawingEnabled}
              />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>
                {t('背景')}
              </Typography.Text>
              <Select
                optionList={backgroundOptions}
                value={form.background}
                onChange={(value) => updateForm({ background: value })}
                style={{ width: '100%' }}
                disabled={!drawingEnabled}
              />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>
                {t('输出格式')}
              </Typography.Text>
              <Select
                optionList={outputFormatOptions}
                value={form.outputFormat}
                onChange={(value) => updateForm({ outputFormat: value })}
                style={{ width: '100%' }}
                disabled={!drawingEnabled}
              />
            </div>
            <div>
              <div className='mb-2 flex items-center gap-1'>
                <Typography.Text strong>{t('输出压缩')}</Typography.Text>
                <Tooltip
                  content={t(
                    '生成图像的压缩级别（0-100%）。此参数仅支持使用 WebP 或 JPEG 输出格式的 GPT 图像模型，默认值为 100',
                  )}
                  position='top'
                  showArrow
                  rePosKey={settingsPanelRePosKey}
                  getPopupContainer={() => document.body}
                >
                  <IconHelpCircle className='cursor-help text-gray-400' />
                </Tooltip>
              </div>
              <InputNumber
                min={0}
                max={100}
                step={1}
                placeholder='0-100'
                value={form.outputCompression}
                onChange={(value) =>
                  updateForm({
                    outputCompression: normalizeOptionalInteger(value),
                  })
                }
                style={{ width: '100%' }}
                disabled={
                  !drawingEnabled || !isCompressionSupported(form.outputFormat)
                }
              />
            </div>
          </div>
        </details>
      </div>

      <div className='mt-5 space-y-3'>
        <div className='grid grid-cols-2 gap-3'>
          <Button
            type='primary'
            theme='solid'
            icon={<Sparkles size={16} />}
            loading={submitting}
            disabled={!drawingEnabled || loadingMeta}
            onClick={handleSubmit}
          >
            {submitting ? t('生成中...') : t('开始生成')}
          </Button>
          {submitting ? (
            <Button
              type='danger'
              theme='light'
              icon={<X size={16} />}
              onClick={cancelGeneration}
            >
              {t('取消请求')}
            </Button>
          ) : (
            <Button
              theme='light'
              icon={<RotateCcw size={16} />}
              onClick={resetForm}
            >
              {t('重置表单')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );

  const renderResultPanel = () => (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{
        padding: 24,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className='mb-5 flex items-center justify-between'>
        <div>
          <Typography.Title heading={5} className='mb-1'>
            {t('生图结果')}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small'>
            {resultImages.length
              ? `${resultImages.length} ${t('张结果')}${restoredFromHistory ? ` · ${t('来自历史')}` : ''}${submitting ? ` · ${t('生成中')}` : ''}`
              : t('还没有生成结果')}
          </Typography.Text>
        </div>
        <Badge
          dot={submitting}
          type={
            submitError
              ? 'danger'
              : resultImages.length
                ? 'success'
                : 'tertiary'
          }
        >
          <Tag
            color={submitError ? 'red' : resultImages.length ? 'green' : 'grey'}
          >
            {submitting
              ? t('生成中')
              : submitError
                ? t('异常')
                : resultImages.length
                  ? t('完成')
                  : t('空闲')}
          </Tag>
        </Badge>
      </div>

      <div className='flex-1 overflow-y-auto pr-1'>
        {submitError ? (
          <Empty
            image={<AlertTriangle size={64} className='text-red-400' />}
            title={t('生成失败')}
            description={submitError}
          />
        ) : resultImages.length === 0 ? (
          submitting ? (
            <div className='flex h-full min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50'>
              <div className='flex flex-col items-center gap-3 text-center'>
                <Spin size='large' />
                <Typography.Text className='whitespace-nowrap text-semi-color-primary'>
                  {t('正在生成图片')}
                </Typography.Text>
              </div>
            </div>
          ) : (
            <Empty
              image={<Images size={64} className='text-gray-400' />}
              title={drawingEnabled ? t('还没有生成结果') : t('绘图功能未启用')}
              description={
                drawingEnabled
                  ? t('选择 API Key，写好提示词后点击开始生成。')
                  : t('请在系统设置的绘图设置中启用绘图功能。')
              }
            />
          )
        ) : (
          <div className='space-y-4'>
            {submitting && (
              <div className='flex items-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-600'>
                <Spin size='small' />
                <Typography.Text className='text-blue-600'>
                  {t('正在生成图片')}
                </Typography.Text>
              </div>
            )}
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 p-3'>
              <Tag color='blue'>{`${t('共')} ${resultImages.length} ${t('张图片')}`}</Tag>
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='small'
                  theme='light'
                  icon={<Copy size={14} />}
                  onClick={copyAllImageLinks}
                >
                  {t('复制全部链接')}
                </Button>
                <Button
                  size='small'
                  theme='light'
                  icon={<Download size={14} />}
                  onClick={downloadAllImages}
                >
                  {t('下载全部')}
                </Button>
              </div>
            </div>
            <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
              {resultImages.map((image, index) => (
                <article
                  key={`${image.url}-${index}`}
                  className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'
                >
                  <button
                    type='button'
                    className='block w-full bg-gray-50'
                    onClick={() =>
                      setPreviewImage({ url: image.url, title: image.fileName })
                    }
                  >
                    <img
                      src={image.url}
                      alt={`${t('生成结果')} ${index + 1}`}
                      className='max-h-[420px] w-full object-contain'
                      loading='lazy'
                    />
                  </button>
                  <div className='space-y-3 p-4'>
                    <div className='flex items-center justify-between gap-3'>
                      <Typography.Text
                        ellipsis={{ showTooltip: true }}
                        type='tertiary'
                        size='small'
                      >
                        {image.fileName}
                      </Typography.Text>
                      {image.isPartial && (
                        <Tag color='orange'>{t('生成中')}</Tag>
                      )}
                    </div>
                    {image.revisedPrompt && (
                      <Typography.Paragraph
                        ellipsis={{ rows: 2, showTooltip: true }}
                        size='small'
                      >
                        {`${t('修订提示词')}: ${image.revisedPrompt}`}
                      </Typography.Paragraph>
                    )}
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        size='small'
                        theme='light'
                        icon={<Eye size={14} />}
                        onClick={() =>
                          setPreviewImage({
                            url: image.url,
                            title: image.fileName,
                          })
                        }
                      >
                        {t('预览')}
                      </Button>
                      <Button
                        size='small'
                        theme='light'
                        icon={<Copy size={14} />}
                        onClick={() => copyImageLink(image)}
                      >
                        {t('复制链接')}
                      </Button>
                      <Button
                        size='small'
                        theme='light'
                        icon={<Download size={14} />}
                        onClick={() => downloadImage(image)}
                      >
                        {t('下载')}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );

  const renderHistoryPanel = () => (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{
        padding: 24,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className='mb-5 flex items-center justify-between'>
        <div>
          <Typography.Title heading={5} className='mb-1'>
            {t('历史记录')}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small'>
            {t('仅保存最近 10 条记录')}
          </Typography.Text>
        </div>
        <Tag color='blue'>{historyEntries.length}</Tag>
      </div>
      {historyEntries.length > 0 && (
        <Button
          className='mb-3'
          theme='light'
          type='danger'
          icon={<Trash2 size={14} />}
          onClick={clearHistory}
        >
          {t('清空历史')}
        </Button>
      )}
      <div className='flex-1 space-y-3 overflow-y-auto pr-1'>
        {historyEntries.length === 0 ? (
          <Empty
            image={<RefreshCw size={56} className='text-gray-400' />}
            title={t('暂无历史记录')}
            description={t('成功生成后会自动保存到这里。')}
          />
        ) : (
          historyEntries.map((entry) => (
            <button
              key={entry.id}
              type='button'
              className={`w-full rounded-2xl border p-3 text-left transition hover:border-purple-300 hover:bg-purple-50 ${entry.id === activeHistoryId ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}
              onClick={() => restoreHistoryEntry(entry)}
            >
              <div className='mb-2 flex items-center justify-between text-xs text-gray-500'>
                <span>{new Date(entry.savedAt).toLocaleString()}</span>
                <span>{`${entry.results.length} ${t('张')}`}</span>
              </div>
              <div className='mb-3 line-clamp-2 text-sm font-semibold text-gray-700'>
                {entry.prompt || t('无提示词')}
              </div>
              <div className='grid grid-cols-4 gap-1'>
                {entry.results.slice(0, 4).map((image, index) => (
                  <div
                    key={`${image.url}-${index}`}
                    className='aspect-square overflow-hidden rounded-lg bg-gray-100'
                  >
                    <img
                      src={image.url}
                      alt={`${t('历史缩略图')} ${index + 1}`}
                      className='h-full w-full object-cover'
                    />
                  </div>
                ))}
              </div>
            </button>
          ))
        )}
      </div>
    </Card>
  );

  return (
    <div className='h-full'>
      <div className='mt-[60px] h-[calc(100vh-66px)] overflow-y-auto bg-transparent p-4 xl:overflow-hidden'>
        <div className='grid min-h-full grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)] xl:h-full xl:grid-cols-[360px_minmax(0,1fr)_320px]'>
          <div className='min-h-[520px] overflow-hidden xl:min-h-0'>
            {renderSettingsPanel()}
          </div>
          <div className='min-h-[520px] overflow-hidden xl:min-h-0'>
            {renderResultPanel()}
          </div>
          <div className='min-h-[360px] overflow-hidden lg:col-span-2 xl:col-span-1 xl:min-h-0'>
            {renderHistoryPanel()}
          </div>
        </div>
      </div>

      <Modal
        title={previewImage?.title || t('图片预览')}
        visible={!!previewImage}
        onCancel={() => setPreviewImage(null)}
        footer={null}
        width='min(920px, 92vw)'
      >
        {previewImage && (
          <div className='pb-3'>
            <div className='mb-2 flex items-center justify-end gap-2'>
              <Tag color='blue'>{Math.round(previewZoom * 100)}%</Tag>
              <Button
                size='small'
                theme='light'
                onClick={resetPreviewZoom}
              >
                {t('重置缩放')}
              </Button>
            </div>
            <div
              ref={previewViewportRef}
              className={`max-h-[75vh] overflow-auto rounded-xl bg-gray-50 select-none ${
                previewZoom > 1
                  ? previewDragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : ''
              }`}
              onWheel={handlePreviewWheel}
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={stopPreviewDrag}
            >
              <img
                src={previewImage.url}
                alt={previewImage.title || t('图片预览')}
                draggable={false}
                className='mx-auto block h-auto object-contain'
                style={{
                  width: `${previewZoom * 100}%`,
                  maxWidth: previewZoom <= 1 ? '100%' : 'none',
                  maxHeight: previewZoom <= 1 ? '75vh' : 'none',
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ImageGeneration;
