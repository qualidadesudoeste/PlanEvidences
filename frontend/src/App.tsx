import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/hooks/useTheme';
import { ToastsProvider } from '@/hooks/useToast';
import Evidences from '@/routes/Evidences';
import QAAssistant from '@/routes/QAAssistant';

export default function App() {
  return (
    <ThemeProvider>
      <ToastsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/evidences" replace />} />
            <Route path="/qa" element={<QAAssistant />} />
            <Route path="/evidences" element={<Evidences />} />
            <Route path="/evidences/:id" element={<Evidences />} />
            <Route path="*" element={<Navigate to="/evidences" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastsProvider>
    </ThemeProvider>
  );
}
