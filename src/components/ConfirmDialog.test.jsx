import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

const C = {
  card: "#1c2035",
  border: "#252a42",
  text: "#dde1f0",
  muted: "#5a6080",
  red: "#f7634f",
};

function renderDialog(props = {}) {
  const defaults = {
    message: "Are you sure?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    C,
  };
  return render(<ConfirmDialog {...defaults} {...props} />);
}

describe('ConfirmDialog', () => {
  describe('Rendering', () => {
    test('displays the message', () => {
      renderDialog({ message: "Delete task 5?" });
      expect(screen.getByText("Delete task 5?")).toBeInTheDocument();
    });

    test('shows Cancel button', () => {
      renderDialog();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    test('shows Delete as default confirm label', () => {
      renderDialog();
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

    test('uses custom confirmLabel when provided', () => {
      renderDialog({ confirmLabel: "Unassign" });
      expect(screen.getByText("Unassign")).toBeInTheDocument();
      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    });

    test('renders backdrop overlay', () => {
      const { container } = renderDialog();
      const backdrop = container.firstChild;
      expect(backdrop.style.position).toBe("fixed");
    });
  });

  describe('Interactions', () => {
    test('clicking Cancel calls onCancel', () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test('clicking Cancel does not call onConfirm', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      renderDialog({ onConfirm, onCancel });
      fireEvent.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    test('clicking confirm button calls onConfirm', () => {
      const onConfirm = vi.fn();
      renderDialog({ onConfirm });
      fireEvent.click(screen.getByText("Delete"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    test('clicking confirm button does not call onCancel', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      renderDialog({ onConfirm, onCancel });
      fireEvent.click(screen.getByText("Delete"));
      expect(onCancel).not.toHaveBeenCalled();
    });

    test('clicking backdrop calls onCancel', () => {
      const onCancel = vi.fn();
      const { container } = renderDialog({ onCancel });
      fireEvent.click(container.firstChild); // the backdrop div
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test('clicking inside the dialog card does not call onCancel', () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      // Click on the message text (inside the card, not the backdrop)
      fireEvent.click(screen.getByText("Are you sure?"));
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('Custom confirm label', () => {
    test('Unassign label variant renders correctly', () => {
      renderDialog({ message: "Unassign all tasks from Alice?", confirmLabel: "Unassign" });
      expect(screen.getByText("Unassign all tasks from Alice?")).toBeInTheDocument();
      expect(screen.getByText("Unassign")).toBeInTheDocument();
    });

    test('confirm button with custom label still triggers onConfirm', () => {
      const onConfirm = vi.fn();
      renderDialog({ confirmLabel: "Unassign", onConfirm });
      fireEvent.click(screen.getByText("Unassign"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
