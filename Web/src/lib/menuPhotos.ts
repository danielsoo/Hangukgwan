'use client'

import { useEffect, useState } from 'react'

/**
 * 대표 메뉴 사진을 주문 시스템의 메뉴(/api/menu)에서 그대로 가져온다.
 *
 * 2026-09-29 사장님: "우리 가게는 대표 메뉴들이 있고 그 메뉴들에 사진이 이미
 * 들어있단 말이야. 그런 걸 바탕으로 사진을 넣어주는데 분위기에 안 맞는 것
 * 같으면 분위기에 어울리는 해당 사진을 ai 로 만들어줘."
 *
 * 홈페이지와 주문 시스템은 같은 주소에서 서빙되므로(src/lib/config.ts) 같은
 * 출처로 부른다. 사장님이 관리자 화면에서 메뉴 사진을 바꾸면 홈페이지도 따라
 * 바뀐다 — 사진을 두 군데에 따로 올릴 필요가 없다.
 *
 * 메뉴 사진이 홈페이지 분위기(어두운 조명·금빛)와 어울리지 않는 요리는
 * SITE_PHOTOS 에 홈페이지 전용 사진을 적는다. 그게 먼저다.
 */

// 홈페이지 전용 사진 — public/photos/ 아래 파일. 메뉴 이름(한국어) → 경로.
// 비어 있으면 메뉴 사진을 쓴다.
//
// 2026-09-29: 메뉴 사진 일곱 장 중 다섯 장이 홈페이지와 어울리지 않았다 —
// 끓이기 전 날것(부대찌개), 사진에 박힌 한자(돌솥비빔밥 「石鍋伴飯」·순두부
// 「海鮮豆腐鍋」), 포스터 필터로 뭉개진 화질(해물파전), 밝은 조명의 날고기
// (삼겹살). 그 메뉴 사진을 참고 이미지로 넣어 같은 요리·같은 그릇·같은 재료로
// AI 가 다시 그린 것이다(Nano Banana 2). 닭갈비는 메뉴 사진 그대로이되 스캔
// 흰 테두리만 잘라냈다(세로로 잘라 보이면 위아래에 흰 줄이 남는다).
export const SITE_PHOTOS: Record<string, string> = {
  부대찌개: '/photos/budae-jjigae.jpg',
  돌솥비빔밥: '/photos/dolsot-bibimbap.jpg',
  해물파전: '/photos/haemul-pajeon.jpg',
  삼겹살: '/photos/samgyeopsal.jpg',
  순두부찌개: '/photos/sundubu-jjigae.jpg',
  닭갈비: '/photos/dakgalbi.jpg',
  동판불고기: '/photos/dongpan-bulgogi.jpg',
}

type MenuItem = { name_ko?: string; photo_url?: string | null }
type MenuCategory = { items?: MenuItem[] }

let cache: Promise<Record<string, string>> | null = null

function loadMenuPhotos(): Promise<Record<string, string>> {
  if (!cache) {
    cache = fetch('/api/menu')
      .then((r) => (r.ok ? r.json() : []))
      .then((cats: MenuCategory[]) => {
        const out: Record<string, string> = {}
        for (const c of Array.isArray(cats) ? cats : []) {
          for (const i of c.items || []) {
            if (i && i.name_ko && i.photo_url && !out[i.name_ko]) out[i.name_ko] = i.photo_url
          }
        }
        return out
      })
      .catch(() => {
        // 못 불렀으면 사진 없이 그린다(빈 면). 다음에 다시 시도할 수 있게 비운다.
        cache = null
        return {}
      })
  }
  return cache
}

/** 요리 이름(한국어) → 사진 주소. 사진이 없으면 undefined. */
export function useDishPhotos(): (ko: string) => string | undefined {
  const [photos, setPhotos] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    loadMenuPhotos().then((p) => {
      if (alive) setPhotos(p)
    })
    return () => {
      alive = false
    }
  }, [])
  return (ko: string) => SITE_PHOTOS[ko] || photos[ko]
}
