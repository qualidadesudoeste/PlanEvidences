import { FileText, History, Moon, Sun, Download, Upload, Sparkles, Trash2 } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface Props {
  view: 'editor' | 'history';
  onChangeView: (v: 'editor' | 'history') => void;
  onExport: () => void;
  onImport: () => void;
  onClear: () => void;
  scenarioCount: number;
  redator: string;
  clientName: string;
}

export function Sidebar({
  view,
  onChangeView,
  onExport,
  onImport,
  onClear,
  scenarioCount,
  redator,
  clientName,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const initials = (redator || 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo">
          <div className="logo-icon">
            <Sparkles size={22} />
          </div>
          <div className="logo-text">
            <h1>PlanEvidences</h1>
            <span>QA Evidence Docs</span>
          </div>
        </div>

        <nav className="sidebar-menu">
          <button
            type="button"
            className={cn('menu-item', view === 'editor' && 'active')}
            onClick={() => onChangeView('editor')}
          >
            <span className="menu-icon">
              <FileText size={18} />
            </span>
            Editor
            {scenarioCount > 0 && <span className="menu-badge">{scenarioCount}</span>}
          </button>

          <button
            type="button"
            className={cn('menu-item', view === 'history' && 'active')}
            onClick={() => onChangeView('history')}
          >
            <span className="menu-icon">
              <History size={18} />
            </span>
            Histórico
          </button>

          <div className="menu-section">Projeto</div>

          <button type="button" className="menu-item" onClick={onExport}>
            <span className="menu-icon">
              <Download size={18} />
            </span>
            Exportar JSON
          </button>
          <button type="button" className="menu-item" onClick={onImport}>
            <span className="menu-icon">
              <Upload size={18} />
            </span>
            Importar JSON
          </button>
          <button type="button" className="menu-item danger" onClick={onClear}>
            <span className="menu-icon">
              <Trash2 size={18} />
            </span>
            Limpar tudo
          </button>
        </nav>
      </div>

      <div>
        <button type="button" className="menu-item" onClick={toggleTheme}>
          <span className="menu-icon">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </span>
          {theme === 'light' ? 'Modo escuro' : 'Modo claro'}
        </button>

        <div className="user-card">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <h4>{redator || 'Usuário'}</h4>
            <span>{clientName || 'Sem cliente'}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
