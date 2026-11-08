import { createRoot } from 'react-dom/client';
import {Player} from '../src/components/page/Player';
import "./index.css";
import '@videojs/react/video/skin';

createRoot(document.getElementById('root')!).render(
  <div style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
  <Player watchId='LCpo_XxWhA4' watchUrl='https://www.youtube.com/watch?v=LCpo_XxWhA4' />
  </div>
);
