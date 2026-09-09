'use client'

/**
 * 사진이 들어갈 자리. `src` 가 오면 사진을, 없으면 조용한 빈 면을 그린다.
 * 사진이 준비되면 각 호출부에 `src` 만 넘기면 되고 나머지는 그대로다.
 *
 * 2026-09-09 — 사장님: "없어도 될 게 있고 있어야 할 게 없어."
 * 사진이 없는 동안 이 자리는 사선 빗금 위에 개발용 메모를 **손님에게 그대로**
 * 보여주고 있었다("招牌菜特寫 · A signature dish, close up",
 * "廚房或老闆夫妻 · Kitchen or owners" …). 한식당 홈페이지에 음식 사진은
 * 한 장도 없고 대신 영어 설명이 붙은 빗금 상자가 15개 있던 셈이다.
 *
 * 이제 label 은 화면에 그리지 않는다 — 사진이 왔을 때 alt 로만 쓴다.
 * 빈 상태는 아주 옅은 면으로 두어 "아직 안 채운 자리"가 아니라 "여백"으로
 * 읽히게 한다.
 */
export default function ImagePlaceholder({
  label,
  aspectRatio,
  src,
  alt,
  minHeight,
}: {
  label: string
  aspectRatio?: string
  src?: string
  alt?: string
  minHeight?: string
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt || label}
        style={{
          position: minHeight ? undefined : 'absolute',
          inset: minHeight ? undefined : 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: minHeight ? 'relative' : 'absolute',
        inset: minHeight ? undefined : 0,
        minHeight,
        width: '100%',
        height: minHeight ? minHeight : '100%',
        aspectRatio,
        // 위에서 아래로 아주 옅게 밝아지는 면. 빗금과 테두리를 빼서
        // "빈 칸"이 아니라 화면의 일부로 보이게 한다.
        background: 'linear-gradient(160deg, var(--bg-alt) 0%, var(--scrim-20) 100%)',
      }}
    />
  )
}
