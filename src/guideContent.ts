import type { Card } from './types';

// The beginner guide's two cards ("Study Your First Opening"): an Italian
// Game Reactions card and Plan card, bundled with the app so they exist for
// everyone regardless of what's in their own repertoires. Studied straight
// from here (see startGuideSession) - never written to storage, so they can't
// be edited, deleted, or wiped by "Restore original content".
//
// The card data below was exported from cards authored in the app itself (not
// hand-typed), so positions and move trees are exactly what the board editor
// produced. The Reactions card's variants are cut to 2 moves each to keep the
// guide short. To change the guide, author the cards in the app and
// re-export them rather than editing this by hand.

export const GUIDE_OPENING_NAME = 'Italian Game';

export const GUIDE_CARDS: Card[] = [
  {"id":"guide-reactions","openingId":"guide-italian-game","order":0,"name":"Reactions","mode":"reactions","boards":[{"id":"93ce9a4d-75bb-426c-a692-2f6f11da0913","order":0,"pieces":{"a8":"bR","a1":"wR","b7":"bP","b2":"wP","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","d6":"bP","b6":"bP","a4":"wP","g4":"bB","h3":"wP"},"turn":"b","castling":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassant":null,"arrows":[],"circles":[],"recording":[{"id":"613b1b47-217a-4621-86a6-5e925e298911","san":"Bxf3","from":"g4","to":"f3","piecesAfter":{"a8":"bR","a1":"wR","b7":"bP","b2":"wP","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h1":"wR","e4":"wP","e5":"bP","f3":"bB","c6":"bN","c4":"wB","f6":"bN","d3":"wP","d6":"bP","b6":"bP","a4":"wP","h3":"wP"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null,"addedArrows":[],"addedCircles":[],"removedArrows":[],"removedCircles":[],"children":[{"id":"f6583d99-32e7-4e0a-97ad-cab0bb66c361","san":"Qxf3","from":"d1","to":"f3","piecesAfter":{"a8":"bR","a1":"wR","b7":"bP","b2":"wP","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h1":"wR","e4":"wP","e5":"bP","f3":"wQ","c6":"bN","c4":"wB","f6":"bN","d3":"wP","d6":"bP","b6":"bP","a4":"wP","h3":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null,"addedArrows":[],"addedCircles":[],"removedArrows":[],"removedCircles":[],"children":[]}]},{"id":"9537a7b6-30b7-4c88-bd3d-5dec219a3b55","san":"Bh5","from":"g4","to":"h5","piecesAfter":{"a8":"bR","a1":"wR","b7":"bP","b2":"wP","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","d6":"bP","b6":"bP","a4":"wP","h3":"wP","h5":"bB"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null,"addedArrows":[],"addedCircles":[],"removedArrows":[],"removedCircles":[],"children":[{"id":"d557966d-f329-4326-b79f-63fb290db558","san":"g4","from":"g2","to":"g4","piecesAfter":{"a8":"bR","a1":"wR","b7":"bP","b2":"wP","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","h8":"bR","h7":"bP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","d6":"bP","b6":"bP","a4":"wP","h3":"wP","h5":"bB","g4":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":"g3","addedArrows":[],"addedCircles":[],"removedArrows":[],"removedCircles":[],"children":[]}]}],"front":{"pieces":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e7":"bP","e2":"wP","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR"},"turn":"w","castling":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassant":null,"arrows":[],"circles":[],"text":"","moves":[]},"back":{"pieces":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e7":"bP","e2":"wP","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR"},"turn":"w","castling":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassant":null,"arrows":[],"circles":[],"text":"","moves":[]}}]},
  {"id":"guide-plan","openingId":"guide-italian-game","order":1,"name":"Plan","mode":"plan","boards":[{"id":"84fda3b5-a1f2-41ce-bcf2-736ced5bce13","order":0,"pieces":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e7":"bP","e2":"wP","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR"},"turn":"w","castling":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassant":null,"arrows":[],"circles":[],"recording":[],"front":{"pieces":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP","d6":"bP"},"turn":"w","castling":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassant":null,"arrows":[],"circles":[],"text":"","moves":[{"from":"e2","to":"e4","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e7":"bP","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":"e3"},{"from":"e7","to":"e5","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":"e6"},{"from":"g1","to":"f3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"b8","to":"c6","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"f1","to":"c4","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"g8","to":"f6","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"d2","to":"d3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"f8","to":"c5","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"b1","to":"c3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"e8","to":"g8","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null},{"from":"a2","to":"a3","piecesAfter":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null},{"from":"d7","to":"d6","piecesAfter":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP","d6":"bP"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null}]},"back":{"pieces":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP","d6":"bP"},"turn":"w","castling":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassant":null,"arrows":[{"from":"c3","to":"a4","color":"green"},{"from":"a4","to":"b6","color":"orange"},{"from":"c1","to":"g5","color":"red"},{"from":"g5","to":"h4","color":"red"}],"circles":[],"text":"1) Trade for dark-squared bishop\n2) Pin kingside knight\n=> If h6 played: c3 Re1","moves":[{"from":"e2","to":"e4","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e7":"bP","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":"e3"},{"from":"e7","to":"e5","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","g1":"wN","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":"e6"},{"from":"g1","to":"f3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b8":"bN","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"b8","to":"c6","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","f1":"wB","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"f1","to":"c4","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g8":"bN","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"g8","to":"f6","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d2":"wP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"d2","to":"d3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f8":"bB","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"f8","to":"c5","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","b1":"wN","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"b1","to":"c3","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e8":"bK","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h8":"bR","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":true,"bQ":true},"enPassantAfter":null},{"from":"e8","to":"g8","piecesAfter":{"a8":"bR","a7":"bP","a2":"wP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null},{"from":"a2","to":"a3","piecesAfter":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d7":"bP","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP"},"turnAfter":"b","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null},{"from":"d7","to":"d6","piecesAfter":{"a8":"bR","a7":"bP","a1":"wR","b7":"bP","b2":"wP","c8":"bB","c7":"bP","c2":"wP","c1":"wB","d8":"bQ","d1":"wQ","e1":"wK","f7":"bP","f2":"wP","g7":"bP","g2":"wP","h7":"bP","h2":"wP","h1":"wR","e4":"wP","e5":"bP","f3":"wN","c6":"bN","c4":"wB","f6":"bN","d3":"wP","c5":"bB","c3":"wN","g8":"bK","f8":"bR","a3":"wP","d6":"bP"},"turnAfter":"w","castlingAfter":{"wK":true,"wQ":true,"bK":false,"bQ":false},"enPassantAfter":null}]}}]}
];

// ---- Coach popups -------------------------------------------------------
// The guide teaches through short popups on the real study screen: each one
// spotlights a piece of the actual UI (board / Hint / Show solution) and
// moves on when the user presses a button or does the thing it points at.

// 'screen' has no spotlight: the popup is centered over a fully dimmed screen.
export type CoachTarget = 'board' | 'hint' | 'solution' | 'continue' | 'screen';
export type CoachEvent = 'branchIntro' | 'yourTurn' | 'allDone' | 'hint' | 'solution' | 'continue';

export interface CoachStep {
  id: string;
  // 'next' = show as soon as the previous step is done; otherwise wait for
  // that moment in the study (a branch starting, a turn of yours, or the
  // card being finished). A moment is used up once the step it started is
  // done, so the same kind of moment can start a later step.
  when: 'next' | 'branchIntro' | 'yourTurn' | 'allDone';
  target: CoachTarget;
  text: string;
  sub?: string;
  // What moves on to the next step: the popup's "Got it", or the user
  // actually pressing Hint / Show solution / Continue.
  advance: 'button' | 'hint' | 'solution' | 'continue';
  // Freeze the study (auto-play, variant walkthrough) while it's showing.
  pause?: boolean;
  // Animated finger dragging between two squares, to show how to draw.
  finger?: { from: string; to: string };
}

export const GUIDE_COACH: Record<string, CoachStep[]> = {
  'guide-reactions': [
    {
      id: 'branch',
      when: 'branchIntro',
      target: 'board',
      text: 'Black can play 2 different moves here. Watch both.',
      sub: 'You create variations like this in the card editor by going back to a move and playing a different one (you will learn this later).',
      advance: 'button',
      pause: true
    },
    {
      id: 'turn',
      when: 'yourTurn',
      target: 'board',
      text: 'Your turn. Play the move you know for this position.',
      sub: 'In your own cards you set up the position and enter the moves yourself.',
      advance: 'button'
    },
    { id: 'hint', when: 'next', target: 'hint', text: 'Not sure? Tap Hint.', advance: 'hint' },
    { id: 'hintShown', when: 'next', target: 'board', text: 'The circle shows which piece to move.', advance: 'button' },
    { id: 'solution', when: 'next', target: 'solution', text: 'Still stuck? Tap Show solution.', advance: 'solution' },
    {
      id: 'solutionDone',
      when: 'next',
      target: 'board',
      text: 'It plays the move for you, but counts as a slip: this card comes back later.',
      advance: 'button',
      pause: true
    },
    // The first turn of yours after the guided part (the branch is over and
    // the main line resumes): from here on it's the user's own attempt.
    {
      id: 'tryYourself',
      when: 'yourTurn',
      target: 'board',
      text: 'Now you try. Play the move yourself.',
      sub: 'Stuck? Hint and Show solution are still there.',
      advance: 'button'
    },
    {
      id: 'continue',
      when: 'allDone',
      target: 'continue',
      text: 'Tap Continue for the next card.',
      advance: 'continue'
    }
  ],
  'guide-plan': [
    {
      id: 'draw',
      when: 'next',
      target: 'board',
      text: 'Draw the plan: drag from one square to another.',
      sub: 'The plan is written above the board (you can write such a description in the card editor, which you will learn later).',
      advance: 'button',
      finger: { from: 'c3', to: 'a4' }
    },
    {
      id: 'solution',
      when: 'next',
      target: 'solution',
      text: 'Stuck? Tap Show solution to draw the next arrow.',
      advance: 'solution'
    },
    {
      id: 'solutionKeep',
      when: 'next',
      target: 'solution',
      text: 'Keep tapping Show solution until the plan is complete.',
      sub: "This is just an example, so you're not expected to know it yet.",
      advance: 'button'
    },
    {
      id: 'continue',
      when: 'allDone',
      target: 'continue',
      text: 'Tap Continue for the next card.',
      advance: 'continue'
    }
  ]
};

// Shown instead of starting round 2: in the guide, using Show solution counts
// as a slip, so every card would come back. Rather than replaying them, this
// explains how rounds work and then the guide ends (back to the home screen).
export const GUIDE_ROUNDS_STEP: CoachStep = {
  id: 'rounds',
  when: 'next',
  target: 'screen',
  text: 'Cards you got wrong come back in a new round.',
  sub: "Round 2 replays only your mistakes, and rounds repeat until every card is right. That's how you learn them by heart.",
  advance: 'button'
};

export const GUIDE_DONE_TEXT =
  "You've studied both card types. Now make your own: open White or Black, add an opening, and create a card.";
