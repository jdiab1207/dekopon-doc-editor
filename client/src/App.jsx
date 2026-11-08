import { Routes, Route, Navigate } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/doc/:id" element={<EditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
