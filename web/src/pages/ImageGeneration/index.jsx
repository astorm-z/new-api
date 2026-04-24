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
  Typography,
} from '@douyinfe/semi-ui';
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
const HISTORY_STORAGE_KEY = 'ai_image_generation_history';
const FORM_STORAGE_KEY = 'ai_image_generation_form';
const HISTORY_LIMIT = 10;
const TOKEN_PAGE_SIZE = 100;

const MODE_GENERATE = 'generate';
const MODE_EDIT = 'edit';
const MODE_MASK = 'mask';

const DEFAULT_FORM = {
  mode: MODE_GENERATE,
  tokenId: undefined,
  model: 'gpt-image-2',
  prompt: '',
  size: '1024x1024',
  count: 1,
  quality: '',
  background: '',
  outputFormat: '',
  outputCompression: undefined,
  partialImages: undefined,
};

const SIZE_OPTIONS = [
  { label: '1024 × 1024', value: '1024x1024' },
  { label: '1536 × 1024（横向）', value: '1536x1024' },
  { label: '1024 × 1536（纵向）', value: '1024x1536' },
  { label: 'auto', value: 'auto' },
];

const QUALITY_OPTIONS = [
  { label: '默认', value: '' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
];

const BACKGROUND_OPTIONS = [
  { label: '默认', value: '' },
  { label: 'transparent', value: 'transparent' },
  { label: 'opaque', value: 'opaque' },
  { label: 'auto', value: 'auto' },
];

const OUTPUT_FORMAT_OPTIONS = [
  { label: '默认', value: '' },
  { label: 'png', value: 'png' },
  { label: 'jpeg', value: 'jpeg' },
  { label: 'webp', value: 'webp' },
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

const getModeLabel = (mode) => {
  switch (mode) {
    case MODE_EDIT:
      return '图生图';
    case MODE_MASK:
      return '图生图（遮罩）';
    case MODE_GENERATE:
    default:
      return '文生图';
  }
};

const normalizeKey = (key) => {
  if (!key) return '';
  return key.startsWith('sk-') ? key : `sk-${key}`;
};

const getBestModel = (availableModels = []) => {
  const availableSet = new Set(availableModels);
  return MODEL_PRIORITY.find((model) => availableSet.has(model)) || MODEL_PRIORITY[0];
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
      const url = item.url || (item.b64_json ? `data:${mimeType};base64,${item.b64_json}` : '');
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
      data?.error?.message || data?.message || data?.raw || `请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
};

const formatQuota = (token) => {
  if (token.unlimited_quota) return '无限额度';
  if (typeof token.remain_quota === 'number') return `剩余额度 ${token.remain_quota}`;
  return '额度未知';
};

const maskTokenKey = (key) => {
  const value = String(key || '').trim();
  if (!value) return '******';
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
};

const formatTokenOptionLabel = (token) =>
  `${token.name || `#${token.id}`}(${maskTokenKey(token.key)})`;

const buildHistoryEntry = (form, images) => ({
  id: `${Date.now()}-${form.mode}-${images.length}`,
  version: 1,
  savedAt: new Date().toISOString(),
  form: {
    ...form,
    tokenId: undefined,
  },
  results: images,
});

const isValidHistoryEntry = (entry) =>
  Boolean(
    entry &&
      entry.version === 1 &&
      typeof entry.id === 'string' &&
      typeof entry.savedAt === 'string' &&
      entry.form &&
      Array.isArray(entry.results) &&
      entry.results.every((image) => image && typeof image.url === 'string'),
  );

const readHistory = () => {
  const entries = safeReadJson(HISTORY_STORAGE_KEY, []);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(isValidHistoryEntry)
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, HISTORY_LIMIT);
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
    const form = safeReadJson(FORM_STORAGE_KEY, {});
    return {
      ...form,
      count: normalizeOptionalInteger(form.count) ?? DEFAULT_FORM.count,
      outputCompression: normalizeOptionalInteger(form.outputCompression),
      partialImages: normalizeOptionalInteger(form.partialImages),
    };
  }, []);
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...savedForm });
  const [tokens, setTokens] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [sourceFiles, setSourceFiles] = useState([]);
  const sourcePreviewUrls = useObjectUrls(sourceFiles);
  const [resultImages, setResultImages] = useState([]);
  const [historyEntries, setHistoryEntries] = useState(() => readHistory());
  const [activeHistoryId, setActiveHistoryId] = useState('');
  const [restoredFromHistory, setRestoredFromHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [maskTool, setMaskTool] = useState('brush');
  const [brushSize, setBrushSize] = useState(44);
  const [maskReady, setMaskReady] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [maskExpanded, setMaskExpanded] = useState(false);

  const abortControllerRef = useRef(null);
  const sourceInputRef = useRef(null);
  const maskBaseCanvasRef = useRef(null);
  const maskPaintCanvasRef = useRef(null);
  const maskPointerDownRef = useRef(false);
  const maskStartPointRef = useRef(null);
  const maskLastPointRef = useRef(null);
  const maskShapeSnapshotRef = useRef(null);
  const maskUndoStackRef = useRef([]);

  const availableModelValues = useMemo(
    () => models.filter((option) => !option.disabled).map((option) => option.value),
    [models],
  );

  const selectedToken = useMemo(
    () => tokens.find((token) => String(token.id) === String(form.tokenId)),
    [tokens, form.tokenId],
  );

  const tokenOptions = useMemo(
    () =>
      tokens.map((token) => ({
        label: formatTokenOptionLabel(token),
        value: String(token.id),
      })),
    [tokens],
  );

  const updateForm = useCallback((patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

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

  const loadMaskEditorImage = useCallback((file) => {
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
      const paintContext = paintCanvas.getContext('2d', { willReadFrequently: true });
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
  }, [resetMaskCanvas, t]);

  useEffect(() => {
    if (form.mode === MODE_MASK && sourceFiles.length === 1) {
      loadMaskEditorImage(sourceFiles[0]);
    } else {
      resetMaskCanvas();
    }
  }, [form.mode, sourceFiles, loadMaskEditorImage, resetMaskCanvas]);

  useEffect(() => {
    const formToSave = { ...form, tokenId: undefined };
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
            const tokenRes = await API.get(`/api/token/?p=${page}&size=${TOKEN_PAGE_SIZE}`);
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

        const [activeTokens, modelRes] = await Promise.all([
          loadAllTokens(),
          API.get('/api/user/models'),
        ]);
        setTokens(activeTokens);

        const { success: modelSuccess, message: modelMessage, data: modelData } =
          modelRes.data || {};
        if (!modelSuccess) {
          throw new Error(modelMessage || t('加载生图配置失败'));
        }

        const userModels = Array.isArray(modelData) ? modelData : [];
        const usableModels = SUPPORTED_IMAGE_MODELS.filter((model) =>
          userModels.includes(model),
        );
        const nextModels = SUPPORTED_IMAGE_MODELS.map((model) => ({
          label: usableModels.includes(model)
            ? model
            : `${model}（${t('未在可用模型中')}）`,
          value: model,
          disabled: !usableModels.includes(model),
        }));
        setModels(nextModels);

        setForm((prev) => {
          const tokenId =
            prev.tokenId &&
            activeTokens.some((token) => String(token.id) === String(prev.tokenId))
              ? String(prev.tokenId)
              : activeTokens[0]?.id
                ? String(activeTokens[0].id)
                : undefined;
          const validModel = usableModels.includes(prev.model)
            ? prev.model
            : getBestModel(usableModels);
          return { ...prev, tokenId, model: validModel };
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
    maskUndoStackRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (maskUndoStackRef.current.length > 20) maskUndoStackRef.current.shift();
  }, [maskReady]);

  const drawMaskLine = useCallback(
    (from, to, erase) => {
      const canvas = maskPaintCanvasRef.current;
      const context = canvas.getContext('2d');
      context.save();
      context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
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
      context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
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
        maskShapeSnapshotRef.current = context.getImageData(0, 0, canvas.width, canvas.height);
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
        if (maskShapeSnapshotRef.current) context.putImageData(maskShapeSnapshotRef.current, 0, 0);
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
    if (!canvas || !maskReady || canvas.width === 0 || canvas.height === 0) return false;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < imageData.length; index += 4) {
      if (imageData[index] > 0) return true;
    }
    return false;
  }, [maskReady]);

  const previewGeneratedMask = useCallback(() => {
    if (!maskReady) {
      Toast.warning(t('请先上传源图'));
      return;
    }
    const maskCanvas = buildMaskCanvas();
    setPreviewImage({ url: maskCanvas.toDataURL('image/png'), title: t('遮罩预览（透明区域会被修改）') });
  }, [buildMaskCanvas, maskReady, t]);

  const createMaskFile = useCallback(
    () =>
      new Promise((resolve, reject) => {
        const maskCanvas = buildMaskCanvas();
        maskCanvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error(t('遮罩生成失败')));
            return;
          }
          resolve(new File([blob], 'mask.png', { type: 'image/png' }));
        }, 'image/png');
      }),
    [buildMaskCanvas, t],
  );

  const validateBeforeSubmit = useCallback(() => {
    if (!drawingEnabled) throw new Error(t('绘图功能未启用'));
    if (!form.tokenId) throw new Error(t('请选择 API Key'));
    if (!SUPPORTED_IMAGE_MODELS.includes(form.model)) throw new Error(t('当前仅支持 gpt-image-1、gpt-image-1.5、gpt-image-2'));
    if (!availableModelValues.includes(form.model)) {
      throw new Error(t('当前用户不可用该模型'));
    }
    if (!form.prompt.trim()) throw new Error(t('请输入提示词'));
    if (form.mode === MODE_EDIT && sourceFiles.length === 0) throw new Error(t('请先上传源图'));
    if (form.mode === MODE_MASK) {
      if (sourceFiles.length !== 1) throw new Error(t('遮罩模式需要且只能上传一张源图'));
      if (!maskHasPixels()) throw new Error(t('请先在源图上绘制遮罩区域'));
    }
    if (!Number.isFinite(form.count) || form.count < 1 || form.count > 10) {
      throw new Error(t('生成数量需要在 1 到 10 之间'));
    }
    if (
      form.outputCompression !== undefined &&
      form.outputCompression !== null &&
      (!Number.isFinite(form.outputCompression) || form.outputCompression < 0 || form.outputCompression > 100)
    ) {
      throw new Error(t('输出压缩需要在 0 到 100 之间'));
    }
  }, [availableModelValues, drawingEnabled, form, maskHasPixels, sourceFiles.length, t]);

  const appendCommonPayloadFields = useCallback((payload) => {
    payload.n = form.count;
    if (form.size) payload.size = form.size;
    if (form.quality) payload.quality = form.quality;
    if (form.background) payload.background = form.background;
    if (form.outputFormat) payload.output_format = form.outputFormat;
    if (Number.isFinite(form.outputCompression)) payload.output_compression = form.outputCompression;
    if (Number.isFinite(form.partialImages) && form.partialImages > 0) {
      payload.partial_images = form.partialImages;
    }
  }, [form]);

  const buildGeneratePayload = useCallback(() => {
    const payload = {
      model: form.model,
      prompt: form.prompt.trim(),
      response_format: 'url',
      stream: true,
    };
    appendCommonPayloadFields(payload);
    return payload;
  }, [appendCommonPayloadFields, form]);

  const buildEditFormData = useCallback(async () => {
    const formData = new FormData();
    formData.append('model', form.model);
    formData.append('prompt', form.prompt.trim());
    formData.append('response_format', 'url');
    formData.append('stream', 'true');
    formData.append('n', String(form.count));
    if (form.size) formData.append('size', form.size);
    if (form.quality) formData.append('quality', form.quality);
    if (form.background) formData.append('background', form.background);
    if (form.outputFormat) formData.append('output_format', form.outputFormat);
    if (Number.isFinite(form.outputCompression)) {
      formData.append('output_compression', String(form.outputCompression));
    }
    if (Number.isFinite(form.partialImages) && form.partialImages > 0) {
      formData.append('partial_images', String(form.partialImages));
    }

    const filesToSend = form.mode === MODE_MASK ? sourceFiles.slice(0, 1) : sourceFiles;
    filesToSend.forEach((file) => formData.append('image', file, file.name));

    if (form.mode === MODE_MASK) {
      const maskFile = await createMaskFile();
      formData.append('mask', maskFile, maskFile.name);
    }

    return formData;
  }, [createMaskFile, form, sourceFiles]);

  const requestImageGeneration = useCallback(
    async (apiKey, signal) => {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'New-Api-User': getUserIdFromLocalStorage(),
      };

      if (form.mode === MODE_GENERATE) {
        const response = await fetch('/v1/images/generations', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildGeneratePayload()),
          signal,
        });
        return parseImageApiResponse(response);
      }

      const response = await fetch('/v1/images/edits', {
        method: 'POST',
        headers,
        body: await buildEditFormData(),
        signal,
      });
      return parseImageApiResponse(response);
    },
    [buildEditFormData, buildGeneratePayload, form.mode],
  );

  const saveHistoryEntry = useCallback((entry) => {
    try {
      const next = [entry, ...readHistory().filter((item) => item.id !== entry.id)].slice(0, HISTORY_LIMIT);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
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
    abortControllerRef.current = new AbortController();

    try {
      const key = normalizeKey(await fetchTokenKey(form.tokenId));
      const response = await requestImageGeneration(key, abortControllerRef.current.signal);
      const images = normalizeResponseImages(response, form.outputFormat);
      if (images.length === 0) {
        throw new Error(t('接口成功返回，但没有可展示的图片'));
      }
      setResultImages(images);
      const entry = buildHistoryEntry(form, images);
      const saved = saveHistoryEntry(entry);
      setActiveHistoryId(entry.id);
      Toast.success(saved ? t('生成成功，已保存到历史记录') : t('生成成功，但历史保存失败'));
    } catch (error) {
      const message = error.name === 'AbortError' ? t('请求已取消') : error.message;
      setSubmitError(message);
      Toast.error(message);
    } finally {
      setSubmitting(false);
      abortControllerRef.current = null;
    }
  }, [form, requestImageGeneration, saveHistoryEntry, submitting, t, validateBeforeSubmit]);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const restoreHistoryEntry = useCallback(
    (entry) => {
      const nextModel =
        SUPPORTED_IMAGE_MODELS.includes(entry.form.model) &&
        availableModelValues.includes(entry.form.model)
          ? entry.form.model
          : getBestModel(availableModelValues);
      setForm((prev) => ({ ...prev, ...entry.form, tokenId: prev.tokenId, model: nextModel }));
      setResultImages(entry.results);
      setSubmitError('');
      setActiveHistoryId(entry.id);
      setRestoredFromHistory(true);
      clearSourceFiles();
      Toast.success(t('已恢复历史记录'));
    },
    [availableModelValues, clearSourceFiles, t],
  );

  const clearHistory = useCallback(() => {
    Modal.confirm({
      title: t('确认清空历史记录？'),
      content: t('历史记录仅保存在当前浏览器，清空后不可恢复。'),
      okType: 'danger',
      onOk: () => {
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
      model: getBestModel(availableModelValues),
    }));
    setSubmitError('');
    setRestoredFromHistory(false);
    clearSourceFiles();
  }, [availableModelValues, clearSourceFiles]);

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
          <Typography.Text strong>{t(form.mode === MODE_MASK ? '源图（仅一张）' : '源图')}</Typography.Text>
          {sourceFiles.length > 0 && (
            <Button size='small' theme='borderless' type='danger' icon={<Trash2 size={14} />} onClick={clearSourceFiles}>
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
          {t(form.mode === MODE_MASK ? '遮罩模式只使用一张源图，遮罩在页面内绘制生成。' : '图生图可上传一张或多张源图。')}
        </Typography.Text>
        {sourcePreviewUrls.length > 0 && (
          <div className='grid grid-cols-3 gap-2'>
            {sourcePreviewUrls.map((url, index) => (
              <button
                key={url}
                type='button'
                className='aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50'
                onClick={() => setPreviewImage({ url, title: `${t('源图')} ${index + 1}` })}
              >
                <img src={url} alt={`${t('源图')} ${index + 1}`} className='h-full w-full object-cover' />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderMaskEditor = () => {
    if (form.mode !== MODE_MASK) return null;
    const editor = (
      <div
        className={`space-y-3 ${
          maskExpanded
            ? 'fixed inset-4 z-[1100] overflow-auto rounded-3xl bg-white p-5 shadow-2xl'
            : ''
        }`}
      >
        <div className='flex items-start justify-between gap-3'>
          <div>
            <Typography.Text strong>{t('遮罩编辑器')}</Typography.Text>
            <div className='mt-1 text-xs text-gray-500'>
              {t('红色标记表示要修改的区域，提交时会自动生成透明编辑区域的 PNG mask。')}
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
          <Button size='small' theme='light' icon={<Undo2 size={14} />} onClick={undoMaskAction} disabled={!maskReady}>
            {t('撤销')}
          </Button>
          <Button size='small' theme='light' icon={<Trash2 size={14} />} onClick={clearMaskCanvas} disabled={!maskReady}>
            {t('清空遮罩')}
          </Button>
          <Button size='small' theme='light' icon={<Eye size={14} />} onClick={previewGeneratedMask} disabled={!maskReady}>
            {t('预览遮罩')}
          </Button>
          <Button size='small' type='primary' theme='light' icon={<Maximize2 size={14} />} onClick={() => setMaskExpanded(true)} disabled={!maskReady}>
            {t('放大编辑')}
          </Button>
        </div>
        <div
          className={`relative overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-gray-50 ${
            maskExpanded ? 'mx-auto max-w-[min(100%,calc((100vh-240px)*1.6))]' : ''
          }`}
        >
          {!maskReady && (
            <div className='flex aspect-square items-center justify-center px-4 text-center text-sm text-gray-500'>
              {t('上传一张源图后开始绘制遮罩')}
            </div>
          )}
          <div className={maskReady ? 'relative' : 'hidden'}>
            <canvas ref={maskBaseCanvasRef} className='block h-auto w-full select-none' />
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
    );

    return editor;
  };

  const renderSettingsPanel = () => (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}
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

      <div className='flex-1 space-y-5 overflow-y-auto pr-2 model-settings-scroll'>
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
          {selectedToken && (
            <div className='mt-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500'>
              <div>{formatTokenOptionLabel(selectedToken)}</div>
              <div>{formatQuota(selectedToken)}</div>
              {selectedToken.group && <div>{`${t('分组')}: ${selectedToken.group}`}</div>}
            </div>
          )}
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>
            {t('模式')}
          </Typography.Text>
          <Tabs type='button' activeKey={form.mode} onChange={handleModeChange} className='w-full'>
            <TabPane tab={t('文生图')} itemKey={MODE_GENERATE} />
            <TabPane tab={t('图生图')} itemKey={MODE_EDIT} />
            <TabPane tab={t('图生图（遮罩）')} itemKey={MODE_MASK} />
          </Tabs>
        </div>

        {renderSourceUploader()}
        {maskExpanded && (
          <div
            className='fixed inset-0 z-[1099] bg-black/40'
            onClick={() => setMaskExpanded(false)}
          />
        )}
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

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div>
            <Typography.Text strong className='mb-2 block'>{t('模型')}</Typography.Text>
            <Select
              optionList={models}
              value={form.model}
              onChange={(value) => updateForm({ model: value })}
              style={{ width: '100%' }}
              disabled={!drawingEnabled || loadingMeta}
            />
          </div>
          <div>
            <Typography.Text strong className='mb-2 block'>{t('数量')}</Typography.Text>
            <InputNumber
              min={1}
              max={10}
              step={1}
              value={form.count}
              onChange={(value) => updateForm({ count: normalizeOptionalInteger(value) ?? DEFAULT_FORM.count })}
              style={{ width: '100%' }}
              disabled={!drawingEnabled}
            />
          </div>
        </div>

        <div>
          <Typography.Text strong className='mb-2 block'>{t('尺寸')}</Typography.Text>
          <Select
            optionList={SIZE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
            value={form.size}
            onChange={(value) => updateForm({ size: value })}
            style={{ width: '100%' }}
            disabled={!drawingEnabled}
          />
        </div>

        <details className='rounded-2xl border border-gray-200 bg-gray-50 p-4'>
          <summary className='cursor-pointer text-sm font-semibold text-gray-700'>{t('高级参数')}</summary>
          <div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div>
              <Typography.Text strong className='mb-2 block'>{t('质量')}</Typography.Text>
              <Select optionList={QUALITY_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={form.quality} onChange={(value) => updateForm({ quality: value })} style={{ width: '100%' }} disabled={!drawingEnabled} />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>{t('背景')}</Typography.Text>
              <Select optionList={BACKGROUND_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={form.background} onChange={(value) => updateForm({ background: value })} style={{ width: '100%' }} disabled={!drawingEnabled} />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>{t('输出格式')}</Typography.Text>
              <Select optionList={OUTPUT_FORMAT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={form.outputFormat} onChange={(value) => updateForm({ outputFormat: value })} style={{ width: '100%' }} disabled={!drawingEnabled} />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>{t('输出压缩')}</Typography.Text>
              <InputNumber min={0} max={100} step={1} placeholder='0-100' value={form.outputCompression} onChange={(value) => updateForm({ outputCompression: normalizeOptionalInteger(value) })} style={{ width: '100%' }} disabled={!drawingEnabled} />
            </div>
            <div>
              <Typography.Text strong className='mb-2 block'>{t('局部预览数')}</Typography.Text>
              <InputNumber min={0} step={1} placeholder='例如 2' value={form.partialImages} onChange={(value) => updateForm({ partialImages: normalizeOptionalInteger(value) })} style={{ width: '100%' }} disabled={!drawingEnabled} />
            </div>
          </div>
        </details>
      </div>

      <div className='mt-5 space-y-3'>
        <div className='grid grid-cols-2 gap-3'>
          <Button type='primary' theme='solid' icon={<Sparkles size={16} />} loading={submitting} disabled={!drawingEnabled || loadingMeta} onClick={handleSubmit}>
            {submitting ? t('生成中...') : t('开始生成')}
          </Button>
          {submitting ? (
            <Button type='danger' theme='light' icon={<X size={16} />} onClick={cancelGeneration}>
              {t('取消请求')}
            </Button>
          ) : (
            <Button theme='light' icon={<RotateCcw size={16} />} onClick={resetForm}>
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
      bodyStyle={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div className='mb-5 flex items-center justify-between'>
        <div>
          <Typography.Title heading={5} className='mb-1'>
            {t('生图结果')}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small'>
            {resultImages.length ? `${resultImages.length} ${t('张结果')}${restoredFromHistory ? ` · ${t('来自历史')}` : ''}` : t('还没有生成结果')}
          </Typography.Text>
        </div>
        <Badge dot={submitting} type={submitError ? 'danger' : resultImages.length ? 'success' : 'tertiary'}>
          <Tag color={submitError ? 'red' : resultImages.length ? 'green' : 'grey'}>
            {submitting ? t('生成中') : submitError ? t('异常') : resultImages.length ? t('完成') : t('空闲')}
          </Tag>
        </Badge>
      </div>

      <div className='flex-1 overflow-y-auto pr-1'>
        {submitting ? (
          <div className='flex h-full min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50'>
            <div className='flex flex-col items-center gap-3 text-center'>
              <Spin size='large' />
              <Typography.Text className='whitespace-nowrap text-semi-color-primary'>
                {t('正在生成图片')}
              </Typography.Text>
            </div>
          </div>
        ) : submitError ? (
          <Empty
            image={<AlertTriangle size={64} className='text-red-400' />}
            title={t('生成失败')}
            description={submitError}
          />
        ) : resultImages.length === 0 ? (
          <Empty
            image={<Images size={64} className='text-gray-400' />}
            title={drawingEnabled ? t('还没有生成结果') : t('绘图功能未启用')}
            description={drawingEnabled ? t('选择 API Key，写好提示词后点击开始生成。') : t('请在系统设置的绘图设置中启用绘图功能。')}
          />
        ) : (
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 p-3'>
              <Tag color='blue'>{`${t('共')} ${resultImages.length} ${t('张图片')}`}</Tag>
              <div className='flex flex-wrap gap-2'>
                <Button size='small' theme='light' icon={<Copy size={14} />} onClick={copyAllImageLinks}>{t('复制全部链接')}</Button>
                <Button size='small' theme='light' icon={<Download size={14} />} onClick={downloadAllImages}>{t('下载全部')}</Button>
              </div>
            </div>
            <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
              {resultImages.map((image, index) => (
                <article key={`${image.url}-${index}`} className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'>
                  <button type='button' className='block w-full bg-gray-50' onClick={() => setPreviewImage({ url: image.url, title: image.fileName })}>
                    <img src={image.url} alt={`${t('生成结果')} ${index + 1}`} className='max-h-[420px] w-full object-contain' loading='lazy' />
                  </button>
                  <div className='space-y-3 p-4'>
                    <Typography.Text ellipsis={{ showTooltip: true }} type='tertiary' size='small'>
                      {image.fileName}
                    </Typography.Text>
                    {image.revisedPrompt && (
                      <Typography.Paragraph ellipsis={{ rows: 2, showTooltip: true }} size='small'>
                        {`${t('修订提示词')}: ${image.revisedPrompt}`}
                      </Typography.Paragraph>
                    )}
                    <div className='flex flex-wrap gap-2'>
                      <Button size='small' theme='light' icon={<Eye size={14} />} onClick={() => setPreviewImage({ url: image.url, title: image.fileName })}>{t('预览')}</Button>
                      <Button size='small' theme='light' icon={<Copy size={14} />} onClick={() => copyImageLink(image)}>{t('复制链接')}</Button>
                      <Button size='small' theme='light' icon={<Download size={14} />} onClick={() => downloadImage(image)}>{t('下载')}</Button>
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
      bodyStyle={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div className='mb-5 flex items-center justify-between'>
        <div>
          <Typography.Title heading={5} className='mb-1'>
            {t('历史记录')}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small'>
            {t('最近 10 次成功生成')}
          </Typography.Text>
        </div>
        <Tag color='blue'>{historyEntries.length}</Tag>
      </div>
      {historyEntries.length > 0 && (
        <Button className='mb-3' theme='light' type='danger' icon={<Trash2 size={14} />} onClick={clearHistory}>
          {t('清空历史')}
        </Button>
      )}
      <div className='flex-1 space-y-3 overflow-y-auto pr-1'>
        {historyEntries.length === 0 ? (
          <Empty image={<RefreshCw size={56} className='text-gray-400' />} title={t('暂无历史记录')} description={t('成功生成后会自动保存到这里。')} />
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
                <span>{t(getModeLabel(entry.form.mode))}</span>
              </div>
              <div className='mb-2 text-sm font-semibold text-gray-700'>
                {`${entry.form.model || DEFAULT_FORM.model} · ${entry.form.size || t('默认尺寸')} · ${entry.results.length} ${t('张')}`}
              </div>
              <div className='mb-3 line-clamp-2 text-xs text-gray-500'>
                {entry.form.prompt || t('无提示词')}
              </div>
              <div className='grid grid-cols-4 gap-1'>
                {entry.results.slice(0, 4).map((image, index) => (
                  <div key={`${image.url}-${index}`} className='aspect-square overflow-hidden rounded-lg bg-gray-100'>
                    <img src={image.url} alt={`${t('历史缩略图')} ${index + 1}`} className='h-full w-full object-cover' />
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
          <div className='min-h-[520px] overflow-hidden xl:min-h-0'>{renderSettingsPanel()}</div>
          <div className='min-h-[520px] overflow-hidden xl:min-h-0'>{renderResultPanel()}</div>
          <div className='min-h-[360px] overflow-hidden lg:col-span-2 xl:col-span-1 xl:min-h-0'>{renderHistoryPanel()}</div>
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
          <img src={previewImage.url} alt={previewImage.title || t('图片预览')} className='max-h-[75vh] w-full object-contain' />
        )}
      </Modal>

    </div>
  );
};

export default ImageGeneration;
