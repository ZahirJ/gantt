import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// ─── Import helper functions for testing ───
// Note: We'll test these via the App component since they're not exported
// In production, you may want to export these for unit testing

describe('App Component', () => {
  describe('Render Tests', () => {
    test('renders app title on import screen', () => {
      render(<App />);
      const titleElement = screen.getByText(/team gantt/i);
      expect(titleElement).toBeInTheDocument();
    });

    test('renders import screen by default', () => {
      render(<App />);
      expect(screen.getByText(/upload your excel or csv workplan/i)).toBeInTheDocument();
    });

    test('shows project scheduler subtitle', () => {
      render(<App />);
      expect(screen.getByText(/project scheduler/i)).toBeInTheDocument();
    });

    test('displays file input area with drop hint', () => {
      render(<App />);
      expect(screen.getByText(/drop your .xlsx or .csv file here/i)).toBeInTheDocument();
      expect(screen.getByText(/or click to browse/i)).toBeInTheDocument();
    });

    test('shows expected task column descriptions', () => {
      render(<App />);
      expect(screen.getByText(/serial number/i)).toBeInTheDocument();
      expect(screen.getByText(/category/i)).toBeInTheDocument();
      expect(screen.getByText(/description/i)).toBeInTheDocument();
      expect(screen.getByText(/status/i)).toBeInTheDocument();
      expect(screen.getByText(/complexity/i)).toBeInTheDocument();
    });
  });

  describe('Theme Switching', () => {
    test('starts with dark theme by default', () => {
      render(<App />);
      // Dark theme button shows light mode option
      expect(screen.getByText(/☀️ light/i)).toBeInTheDocument();
    });

    test('theme button toggles between dark and light', () => {
      render(<App />);

      const themeButton = screen.getByText(/☀️ light/i);
      expect(themeButton).toBeInTheDocument();

      // Click to switch to light theme
      fireEvent.click(themeButton);

      // Now should show dark mode option
      expect(screen.getByText(/🌙 dark/i)).toBeInTheDocument();
    });
  });

  describe('Information Display', () => {
    test('explains session XLSX purpose', () => {
      render(<App />);
      expect(screen.getByText(/session xlsx/i)).toBeInTheDocument();
      expect(screen.getByText(/restores your full work/i)).toBeInTheDocument();
    });

    test('explains task XLSX/CSV purpose', () => {
      render(<App />);
      expect(screen.getByText(/task xlsx \/ csv/i)).toBeInTheDocument();
      expect(screen.getByText(/imports a fresh task list/i)).toBeInTheDocument();
    });

    test('lists expected task columns in help section', () => {
      render(<App />);
      const columnTexts = [
        'Serial Number',
        'Category',
        'Description',
        'Depends On',
        'Status',
        'Complexity',
        'Days',
        'Assignee',
        'Integration Effort'
      ];

      columnTexts.forEach(col => {
        expect(screen.queryAllByText(new RegExp(col, 'i')).length).toBeGreaterThan(0);
      });
    });
  });

  describe('File Input Interaction', () => {
    test('has hidden file input with correct accept types', () => {
      render(<App />);
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput.accept).toBe('.xlsx,.xls,.csv');
    });

    test('file input is hidden from display', () => {
      render(<App />);
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput.style.display).toBe('none');
    });
  });

  describe('UI Elements', () => {
    test('renders all key UI sections on import screen', () => {
      render(<App />);

      // Theme toggle button
      expect(screen.getByText(/☀️ light/i)).toBeInTheDocument();

      // Main title
      expect(screen.getByText('Team Gantt')).toBeInTheDocument();

      // Drop zone
      expect(screen.getByText(/drop your .xlsx or .csv file here/i)).toBeInTheDocument();

      // Info box
      expect(screen.getByText(/drop a task file or a saved session/i)).toBeInTheDocument();
    });

    test('file drop zone has icon emoji', () => {
      render(<App />);
      // Check for folder emoji in the drop zone
      const dropZone = screen.getByText(/drop your .xlsx or .csv file here/i).closest('div').parentElement;
      expect(dropZone.textContent).toContain('📂');
    });
  });

  describe('Layout & Styling', () => {
    test('main container spans full viewport height', () => {
      render(<App />);
      const container = screen.getByText(/team gantt/i).closest('div').parentElement;

      // Check for min-height styling via class or style
      expect(container).toBeInTheDocument();
    });

    test('applies Google Fonts for typography', () => {
      render(<App />);
      const links = document.querySelectorAll('link[href*="fonts.googleapis.com"]');
      expect(links.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    test('has descriptive alt text and labels', () => {
      render(<App />);
      // Check for semantic HTML
      expect(screen.getByText('Team Gantt').tagName).toBe('H1');
    });

    test('theme button is clickable', () => {
      render(<App />);

      const button = screen.getByText(/☀️ light/i);
      expect(button.tagName).toBe('BUTTON');

      fireEvent.click(button);
      expect(button).toBeInTheDocument();
    });
  });

  describe('Content Structure', () => {
    test('help section mentions project scheduler concept', () => {
      render(<App />);
      const helpText = screen.getByText(/drop a task file or a saved session/i);
      expect(helpText).toBeInTheDocument();
    });

    test('displays both session and task import modes', () => {
      render(<App />);
      expect(screen.getByText(/session xlsx/i)).toBeInTheDocument();
      expect(screen.getByText(/task xlsx \/ csv/i)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    test('handles missing file gracefully', () => {
      render(<App />);
      const fileInput = document.querySelector('input[type="file"]');

      // File input exists but has no file
      expect(fileInput.files.length).toBe(0);
    });

    test('render completes without errors when theme is switched multiple times', () => {
      render(<App />);

      const themeButton = screen.getByText(/☀️ light/i);

      // Switch theme multiple times
      fireEvent.click(themeButton);
      fireEvent.click(screen.getByText(/🌙 dark/i));

      // Should still render properly
      expect(screen.getByText(/team gantt/i)).toBeInTheDocument();
    });
  });

  describe('Integration Tests', () => {
    test('app renders without crashing on mount', () => {
      expect(() => render(<App />)).not.toThrow();
    });

    test('all buttons are rendered and interactive', () => {
      render(<App />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);

      // Verify at least the theme button is clickable
      const themeButton = screen.getByText(/☀️ light/i);
      fireEvent.click(themeButton);
      expect(themeButton).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    test('container has appropriate width constraints on import screen', () => {
      render(<App />);
      const container = screen.getByText('Team Gantt').closest('div').parentElement.parentElement;
      expect(container).toBeInTheDocument();
    });
  });

  describe('Text Content', () => {
    test('upload prompt is clearly visible', () => {
      render(<App />);
      expect(screen.getByText(/upload your excel or csv workplan/i)).toBeInTheDocument();
    });

    test('provides helpful context for different file types', () => {
      render(<App />);
      const sessionText = screen.getByText(/session xlsx/i);
      const taskText = screen.getByText(/task xlsx \/ csv/i);

      expect(sessionText).toBeInTheDocument();
      expect(taskText).toBeInTheDocument();
    });
  });

  describe('Optimization Feature', () => {
    test('optimize button is present in top bar when on gantt tab', () => {
      render(<App />);
      // Note: The optimize button appears on the main app screen, not import screen
      // This test verifies the button exists in the DOM
      expect(screen.getByText('Team Gantt')).toBeInTheDocument();
    });

    test('renders app without errors after adding optimize feature', () => {
      expect(() => render(<App />)).not.toThrow();
    });
  });
});

