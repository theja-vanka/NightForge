import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { buildConfigYaml } from '../src/utils/configBuilder.js';
const base = { taskType: 'Classification', datasetFormat: 'Folder', folderPath: '/dataset', numClasses: 3 };
const config = (fields = {}, runId) => yaml.load(buildConfigYaml({ ...base, ...fields }, runId));
test('all settings reach the appropriate model, data and trainer fields', () => {
  const c = config({ datasetFormat:'CSV', trainPath:'C:\\data: train\\train.csv', valPath:'val #1.csv', testPath:'test.csv', imageFolderPath:'C:\\images\\', seed:0, learningRate:0.002, weightDecay:0, optimizer:'adam', scheduler:'none', freezeBackbone:true, batchSize:8, imageSize:256, augmentationPreset:'strong', numWorkers:0, maxEpochs:20, gradientClipVal:0, earlyStopping:true, earlyStoppingPatience:0 });
  assert.equal(c.seed_everything, 0);
  assert.equal(c.model.init_args.scheduler, null);
  assert.equal(c.model.init_args.lr, .002);
  assert.equal(c.model.init_args.weight_decay, 0);
  assert.equal(c.model.init_args.freeze_backbone, true);
  assert.equal(c.data.init_args.image_dir, 'C:\\images\\');
  assert.equal(c.data.init_args.train_csv, 'C:\\data: train\\train.csv');
  assert.equal(c.data.init_args.val_csv, 'val #1.csv');
  assert.equal(c.data.init_args.num_workers, 0);
  assert.equal(c.trainer.callbacks[0].init_args.patience, 0);
  assert.equal(c.trainer.max_epochs, 20);
  assert.equal(c.trainer.gradient_clip_val, 0);
});
test('multi-label uses its own data module and accepted model flag', () => {
  const c = config({taskType:'Multi-Label Classification', datasetFormat:'CSV', trainPath:'train.csv'});
  assert.equal(c.data.class_path, 'autotimm.MultiLabelImageDataModule');
  assert.equal(c.model.init_args.multi_label, true);
  assert.equal(c.model.init_args.metrics[0].params.num_labels, 3);
});
for (const [format, expected] of Object.entries({'PNG Masks':'png', COCO:'coco', Cityscapes:'cityscapes', VOC:'voc', CSV:'csv'})) {
  test(`semantic segmentation ${format}`, () => {
    const c = config({taskType:'Semantic Segmentation', datasetFormat:format, trainPath:'train.csv', imageFolderPath:'/images'});
    assert.equal(c.data.init_args.format, expected);
    assert.equal(c.data.init_args.data_dir, format === 'CSV' ? '/images' : '/dataset');
  });
}
test('YOLOX uses model_name and epoch schedule without unsupported freeze flag', () => {
  const c = config({taskType:'Object Detection', datasetFormat:'COCO JSON', detectionArch:'yolox', maxEpochs:50});
  assert.equal(c.model.init_args.model_name, 'yolox-nano');
  assert.equal(c.model.init_args.total_epochs, 50);
  assert.equal(c.model.init_args.freeze_backbone, undefined);
});
for (const accelerator of ['auto','cuda','mps','cpu']) test(`portable ${accelerator} configuration`, () => {
  const c = config({accelerator});
  assert.equal(c.trainer.accelerator, accelerator);
  assert.equal(c.trainer.devices, ['cpu','mps'].includes(accelerator) ? 1 : 'auto');
  assert.equal(c.trainer.precision, '32-true');
  assert.equal(c.model.init_args.compile_model, false);
});
test('CUDA IDs preserve index semantics including a single GPU', () => {
  assert.equal(config({gpuDevices:'0'}).trainer.devices, '0,');
  assert.equal(config({gpuDevices:'2, 0'}).trainer.devices, '2,0');
});
test('paths, run IDs and roots round-trip without YAML type coercion', () => {
  for (const folderPath of ['/', 'C:\\', '/data: train/#images', 'true', 'a\nb']) {
    assert.equal(config({folderPath}, 'null').data.init_args.data_dir, folderPath);
    assert.equal(config({folderPath}, 'null').trainer.logger[0].init_args.params.name, 'null');
  }
});
test('reject invalid device, numeric and unsupported format configurations', () => {
  for (const fields of [{gpuDevices:'0,0'}, {gpuDevices:'0,foo'}, {accelerator:'cpu',gpuDevices:'0'}, {accelerator:'mps',precision:'64-true'}, {numWorkers:-1}, {batchSize:NaN}, {datasetFormat:'JSONL'}, {maxEpochs:0}]) assert.throws(() => config(fields));
});
test('unset numeric values are omitted', () => {
  const c = config({seed:'', learningRate:null, batchSize:null});
  assert.equal(c.seed_everything, undefined);
  assert.equal(c.model.init_args.lr, undefined);
  assert.equal(c.data.init_args.batch_size, undefined);
});

test('unsupported YOLOX options are not emitted', () => {
  const c = config({taskType:'Object Detection', datasetFormat:'COCO JSON', detectionArch:'yolox', freezeBackbone:true});
  assert.equal(c.model.init_args.freeze_backbone, undefined);
});

test('CSV mapping survives YAML for classification, detection and instances', () => {
  for (const taskType of ['Classification', 'Object Detection', 'Instance Segmentation']) {
    const c = config({taskType, datasetFormat:'CSV', trainPath:'train.csv', imageColumn:'scan path', labelColumn:'diagnosis: final'});
    assert.equal(c.data.init_args.image_column, 'scan path');
    assert.equal(c.data.init_args.label_column, 'diagnosis: final');
    assert.equal(c.data.init_args.label_columns, undefined);
  }
});
test('multi-label CSV mapping emits a list of binary label columns', () => {
  const c = config({taskType:'Multi-Label Classification',datasetFormat:'CSV',trainPath:'train.csv',imageColumn:'scan',labelColumns:' cat, dog '});
  assert.equal(c.data.init_args.image_column,'scan');
  assert.deepEqual(c.data.init_args.label_columns,['cat','dog']);
  assert.equal(c.data.init_args.label_column,undefined);
});
test('blank mappings preserve defaults; non-CSV datasets do not emit column fields', () => {
  assert.equal(config({datasetFormat:'CSV',trainPath:'train.csv',imageColumn:' ',labelColumn:''}).data.init_args.image_column,undefined);
  assert.equal(config({imageColumn:'scan',labelColumn:'category'}).data.init_args.image_column,undefined);
});
test('conflicting and duplicate column mappings are rejected', () => {
  assert.throws(() => config({datasetFormat:'CSV',imageColumn:'image',labelColumn:'image'}), /different/);
  assert.throws(() => config({taskType:'Multi-Label Classification',datasetFormat:'CSV',labelColumns:'cat,cat'}), /unique/);
});
