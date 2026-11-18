/** Project-owned text, including IME composition. Blur only ends an undo session. */
export default function LiveTextInput({
  value,
  label = '텍스트 내용',
  edit,
  finish,
  className = 'text-content',
}: {
  value: string;
  label?: string;
  edit: (value: string) => void;
  finish: () => void;
  className?: string;
}) {
  return (
    <textarea
      aria-label={label}
      className={className}
      rows={4}
      value={value}
      placeholder="자막을 입력하세요"
      onChange={(e) => edit(e.currentTarget.value)}
      onCompositionEnd={(e) => edit(e.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing)
          e.currentTarget.blur();
      }}
    />
  );
}
