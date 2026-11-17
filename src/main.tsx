import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAdminAuthFetch } from './firebase/adminSession.ts';

// V5.3.1: administrator requests carry a verifiable Firebase ID token (see adminSession.ts).
installAdminAuthFetch();

createRoot(document.getElementById('root')!).render(<App />);
