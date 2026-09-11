export const MODEL_CATEGORIES = {
  Edge: {
    desc: "Lightweight models for mobile & embedded deployment",
    models: [
      "mobilenetv2_100",
      "mobilenetv2_140",
      "mobilenetv2_050",
      "mobilenetv3_small_100",
    ],
  },
  Balanced: {
    desc: "Good accuracy-speed tradeoff for general use",
    models: [
      "efficientnet_b2",
      "efficientnet_b3",
      "efficientnet_b0",
      "efficientnet_lite0",
    ],
  },
  Cloud: {
    desc: "High-accuracy models for server-side inference",
    models: [
      "swin_base_patch4_window7_224",
      "swin_large_patch4_window7_224",
      "deit3_base_patch16_224",
      "beit_base_patch16_224",
    ],
  },
  Research: {
    desc: "State-of-the-art transformer architectures",
    models: [
      "eva02_large_patch14_448.mim_m38m_ft_in22k_in1k",
      "eva02_base_patch14_448.mim_in22k_ft_in22k_in1k",
      "convnextv2_huge.fcmae_ft_in22k_in1k_512",
      "maxvit_xlarge_tf_512.in21k_ft_in1k",
    ],
  },
};

export const DETECTION_ARCHS = ["fcos", "yolox"];

export const YOLOX_MODEL_CATEGORIES = {
  Edge: {
    desc: "Lightweight YOLOX variants for mobile & embedded",
    models: ["yolox-nano", "yolox-tiny"],
  },
  Balanced: {
    desc: "Good accuracy-speed tradeoff for general use",
    models: ["yolox-s", "yolox-m"],
  },
  Cloud: {
    desc: "High-accuracy YOLOX for server-side inference",
    models: ["yolox-l", "yolox-x"],
  },
  Research: {
    desc: "Largest YOLOX variant for maximum accuracy",
    models: ["yolox-x"],
  },
};

export const DETECTION_MODEL_CATEGORIES = {
  Edge: {
    desc: "Lightweight models for mobile & embedded detection",
    models: [
      "mobilenetv2_100",
      "mobilenetv2_140",
      "mobilenetv3_small_100",
      "mobilenetv3_large_100",
    ],
  },
  Balanced: {
    desc: "Good accuracy-speed tradeoff for general use",
    models: [
      "resnet50",
      "resnet101",
      "efficientnet_b3",
      "efficientnet_b4",
    ],
  },
  Cloud: {
    desc: "High-accuracy models for server-side detection",
    models: [
      "swin_base_patch4_window7_224",
      "swin_large_patch4_window7_224",
      "convnext_base",
      "convnext_large",
    ],
  },
  Research: {
    desc: "State-of-the-art architectures for dense prediction",
    models: [
      "convnextv2_huge.fcmae_ft_in22k_in1k_512",
      "swin_large_patch4_window12_384",
      "convnextv2_large.fcmae_ft_in22k_in1k_384",
      "convnext_xlarge_384_in22ft1k",
    ],
  },
};

export const SEGMENTATION_MODEL_CATEGORIES = {
  Edge: {
    desc: "Lightweight models for mobile & embedded segmentation",
    models: [
      "mobilenetv2_100",
      "mobilenetv2_140",
      "mobilenetv3_small_100",
      "mobilenetv3_large_100",
    ],
  },
  Balanced: {
    desc: "Good accuracy-speed tradeoff for general use",
    models: [
      "resnet50",
      "resnet101",
      "efficientnet_b3",
      "efficientnet_b4",
    ],
  },
  Cloud: {
    desc: "High-accuracy models for server-side segmentation",
    models: [
      "swin_base_patch4_window7_224",
      "swin_large_patch4_window7_224",
      "convnext_base",
      "convnext_large",
    ],
  },
  Research: {
    desc: "State-of-the-art architectures for dense prediction",
    models: [
      "convnextv2_huge.fcmae_ft_in22k_in1k_512",
      "swin_large_patch4_window12_384",
      "convnextv2_large.fcmae_ft_in22k_in1k_384",
      "convnext_xlarge_384_in22ft1k",
    ],
  },
};

export const SEG_HEAD_TYPES = ["deeplabv3plus", "fcn"];

