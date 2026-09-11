"""Validate generated YAML against an installed AutoTimm, without model creation/training.
Run with the Python interpreter from the training environment; Node must be on PATH.
"""
import json
from pathlib import Path
import subprocess

import pytorch_lightning as pl
from pytorch_lightning.cli import LightningArgumentParser
from autotimm.training.trainer import AutoTrainer

root = Path(__file__).resolve().parents[1]
source = r'''
import {buildConfigYaml} from './src/utils/configBuilder.js';
const configs = [];
for (const taskType of ['Classification','Multi-Label Classification','Object Detection','Semantic Segmentation','Instance Segmentation']) {
  for (const accelerator of ['auto','cuda','cpu','mps']) {
    const p = {taskType,accelerator,numClasses:3,datasetFormat:'CSV',trainPath:'/data/train.csv',valPath:'/data/val.csv',testPath:'/data/test.csv',imageFolderPath:'/images',imageColumn:'scan',labelColumn:'diagnosis',labelColumns:'cat,dog,bird',earlyStopping:true,earlyStoppingPatience:0,scheduler:'none',numWorkers:0,seed:42};
    configs.push([`${taskType}/${accelerator}`,buildConfigYaml(p)]);
  }
}
configs.push(['YOLOX',buildConfigYaml({taskType:'Object Detection',detectionArch:'yolox',datasetFormat:'COCO JSON',folderPath:'/data',numClasses:3})]);
configs.push(['CUDA index zero',buildConfigYaml({taskType:'Classification',datasetFormat:'Folder',folderPath:'/data',numClasses:3,gpuDevices:'0'})]);
console.log(JSON.stringify(configs));
'''
configs = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source], cwd=root, text=True))
parser = LightningArgumentParser(exit_on_error=False)
parser.add_argument('--seed_everything', type=int)
parser.add_lightning_class_args(AutoTrainer, 'trainer')
parser.add_lightning_class_args(pl.LightningModule, 'model', subclass_mode=True)
parser.add_lightning_class_args(pl.LightningDataModule, 'data', subclass_mode=True)
for name, contents in configs:
    parser.parse_string(contents)
    print('PASS', name)
print(f'{len(configs)} configurations accepted; no classes instantiated and no training started.')
