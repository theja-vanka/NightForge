# Training configuration

NightFlow regenerates `config.yaml` from saved project settings before training. Configuration-write failures now stop launch. Settings validation errors are shown when saving or launching.

## Settings mapping

- Model category and task select the task class and initial backbone. AutoTimm supplies the training/tuning implementation.
- Learning rate, optimizer, scheduler, weight decay and backbone freezing belong to `model.init_args`. Selecting no scheduler writes YAML `null` instead of accepting AutoTimm's cosine default. YOLOX has no `freeze_backbone` argument; it receives `model_name` and `total_epochs`.
- Multi-label classification uses `MultiLabelImageDataModule` and `multi_label: true`. Its CSV contains an image column followed by one binary column per label.
- CSV train, validation and test paths are serialized separately. The image-root setting maps to `image_dir`, or `data_dir` for semantic segmentation.
- Semantic segmentation emits the selected format (`png`, `coco`, `cityscapes`, `voc`, or `csv`).
- Batch size, image size, augmentation preset and loader workers belong to `data.init_args`. Zero workers is valid.
- Epochs, accelerator, device selection, precision, gradient clipping and early stopping belong to `trainer`. Zero patience and zero clipping are preserved.
- Seed is written as `seed_everything`. An empty seed remains unset after reopening a project.
- Project names, connection details, display class names and project paths are app metadata, not arbitrary AutoTimm constructor arguments.

## CSV column mapping

When CSV is selected, the project wizard and dataset settings show a CSV columns section. Enter the exact image-path and label headers. Multi-label projects accept comma-separated binary label-column names. The mappings are saved with the project, used by dataset previews, and emitted as `image_column`, `label_column`, or `label_columns` in training YAML. Blank fields preserve loader defaults. Semantic segmentation uses image and mask columns rather than class-label columns; its loader requires `image_path` and `mask_path` (or the first two columns).

## Hardware

Choose Auto, NVIDIA CUDA, Apple Metal (MPS), or CPU in advanced settings. Auto resolves availability on the machine running AutoTimm. CPU covers supported Intel, AMD and Apple silicon Python/PyTorch environments. GPU IDs apply only to CUDA; a single index is serialized with a trailing comma to distinguish it from a device count. CPU and Metal use one device. Full 32-bit precision and compilation off are portable defaults; float64 on Metal is rejected. Actual availability depends on the installed PyTorch build, operating system and hardware.

## Current limitations

The checked AutoTimm version is 0.7.34. Its training loaders accept CSV, not JSONL. JSONL is no longer offered for new training selections; existing JSONL projects receive a conversion error. Browsing support is separate from training support.

The managed training command currently starts local processes. Remote projects receive an explicit error directing users to the connected remote terminal, instead of silently launching a local process with remote paths. Managed SSH training/recovery remains unimplemented.

These checks do not establish model convergence or successful training on every hardware/backend combination. No training was started during this review.

## Validation

- `npm test`: YAML regression tests.
- `npm run lint` and `npm run build`: frontend checks.
- `cargo test --manifest-path src-tauri/Cargo.toml`: command/log-reader tests.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`: Rust checks.
- With AutoTimm installed, `python tests/check_autotimm_config.py`: validates 22 generated configurations through AutoTimm's Lightning argument parser, without constructing models or running training.
