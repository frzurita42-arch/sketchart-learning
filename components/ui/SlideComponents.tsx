// Component registry + dispatcher. The AI picks a component "type" per slide;
// this maps each type to its renderer (one file per type). Ported from
// public/js/ui/index.js (renderComponents / SlideComponents).
import { Text } from './Text';
import { Keypoints } from './Keypoints';
import { Definition } from './Definition';
import { Example } from './Example';
import { Table } from './Table';
import { Latex } from './Latex';
import { Code } from './Code';
import { Svg } from './Svg';
import { Image } from './Image';
import { StickyNote } from './StickyNote';
import { Chart } from './Chart';

const REGISTRY: Record<string, (props: { c: any }) => any> = {
  text: Text,
  keypoints: Keypoints,
  definition: Definition,
  example: Example,
  table: Table,
  latex: Latex,
  code: Code,
  svg: Svg,
  image: Image,
  stickynote: StickyNote,
  chart: Chart,
};

export function SlideComponents({ components }: { components: any[] }) {
  return (
    <>
      {(components || []).map((c: any, i: number) => {
        const Comp = REGISTRY[c?.type];
        return Comp ? <Comp key={i} c={c} /> : null;
      })}
    </>
  );
}
