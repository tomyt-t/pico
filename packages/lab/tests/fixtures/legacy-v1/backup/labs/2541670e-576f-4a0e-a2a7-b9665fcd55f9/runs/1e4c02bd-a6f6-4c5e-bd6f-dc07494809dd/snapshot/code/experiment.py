import json, os
from pathlib import Path
source = next(Path(os.environ['PICO_INPUTS_DIR']).glob('*/samples.json'))
values = json.loads(source.read_text())
mean = sum(values) / len(values)
outputs = Path(os.environ['PICO_OUTPUT_DIR'])
(outputs / 'metrics.json').write_text(json.dumps([{'name':'mean','value':mean,'unit':'score','split':'fixture'},{'name':'count','value':len(values),'unit':'examples','split':'fixture'}]))
(outputs / 'observations.json').write_text(json.dumps({'values':values,'mean':mean}))
print(f'Legacy fixture measured mean={mean} from {len(values)} samples')
