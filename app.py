import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium
from streamlit_js_eval import streamlit_js_eval
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
import os

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 
ABA_AVISTAMENTOS = "Avistamentos"

geolocator = Nominatim(user_agent="PetAlertaSCS_App_V4")

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'user_lat' not in st.session_state: st.session_state.user_lat = None
if 'user_lng' not in st.session_state: st.session_state.user_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None
if 'pet_foco' not in st.session_state: st.session_state.pet_foco = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# ==========================================
# 🎨 FRONT-END: CSS PREMIUM COMPACTO
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    /* Banner */
    .header-banner {
        width: 100% !important;
        border-radius: 15px !important;
        margin-bottom: 15px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
    }

    /* Card Compacto */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: var(--secondary-background-color) !important;
        border: 1px solid rgba(128, 128, 128, 0.1) !important;
        border-radius: 20px !important;
        padding: 12px 15px !important; /* Padding reduzido */
        transition: all 0.2s ease-in-out !important;
        margin-bottom: -10px !important; /* Aproxima os cards */
    }
    
    [data-testid="stVerticalBlockBorderWrapper"]:hover {
        transform: scale(1.01) !important;
        border: 1px solid #ff4b4b !important;
    }

    /* Nome do Pet e Status */
    .nome-pet {
        color: var(--text-color) !important;
        font-size: 1.3rem !important;
        font-weight: 600 !important;
        margin: 0 !important;
        display: inline-block;
    }

    .tag-status {
        background-color: #ff4b4b;
        color: white;
        padding: 1px 8px;
        border-radius: 6px;
        font-size: 0.65rem;
        font-weight: 700;
        vertical-align: middle;
        margin-left: 10px;
    }

    /* Informações em linha */
    .info-container {
        font-size: 0.85rem;
        color: var(--text-color);
        margin-top: 5px;
        line-height: 1.3;
    }

    .info-label {
        opacity: 0.6;
        font-weight: 400;
    }

    .info-valor {
        font-weight: 500;
    }

    /* Botões mais baixos */
    .stButton>button {
        border-radius: 12px !important;
        font-size: 0.75rem !important;
        height: 32px !important;
        padding: 0 10px !important;
    }

    /* Mapa */
    .stFolium {
        border-radius: 20px !important;
    }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES GLOBAIS ---
def renderizar_header():
    banner_path = "assets/Banner.png"
    if os.path.exists(banner_path):
        with open(banner_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
            st.markdown(f'<img src="data:image/png;base64,{data}" class="header-banner">', unsafe_allow_html=True)
    st.write("")

def ler_planilha(aba):
    try: return conn.read(worksheet=aba, ttl=5).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

# ==========================================
# 🛰️ GPS E NAVEGAÇÃO
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps: st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("## 🐾 PetAlerta SCS")
    if st.button("🏠 Mural de Pets", use_container_width=True): ir_para('home')
    if st.button("🏆 Hall da Fama", use_container_width=True): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u.lower()) & (df_u['Senha'].astype(str) == p)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; st.rerun()

renderizar_header()

# PÁGINA DE ZOOM
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None; st.rerun()
    st.stop()

# ==========================================
# PÁGINA: HOME
# ==========================================
if st.session_state.pagina == 'home':
    df_pets = ler_planilha(ABA_PETS)
    df_avis = ler_planilha(ABA_AVISTAMENTOS)

    # MAPA COM ÍCONES
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    for _, p in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        esp = str(p['Especie']).lower()
        ic = 'dog' if 'cão' in esp or 'cao' in esp else 'cat' if 'gato' in esp else 'paw'
        
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == str(p['ID'])]
        lat, lng, cor = p['Lat'], p['Lng'], 'orange'
        if not avis_pet.empty:
            ultimo = avis_pet.iloc[-1]
            lat, lng, cor = ultimo['Lat'], ultimo['Lng'], 'red'
        
        folium.Marker([lat, lng], popup=p['Nome_Pet'], icon=folium.Icon(color=cor, icon=ic, prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=350)

    st.markdown("### 🔍 Desaparecidos Recentemente")
    
    for _, pet in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        
        # Lógica de Avistamento (Sem símbolos **)
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == p_id]
        if not avis_pet.empty:
            u = avis_pet.iloc[-1]
            label_loc = "Visto por último em:"
            valor_loc = f"{u['Bairro']} ({u['Data_Hora']})"
        else:
            label_loc = "Sumiu em:"
            valor_loc = f"{pet['Local_Desaparecimento']} ({pet['Data']})"

        # CARD COMPACTO
        with st.container(border=True):
            c_img, c_txt = st.columns([1, 2.5])
            
            with c_img:
                st.image(pet['Foto'], use_container_width=True)
            
            with c_txt:
                # Título e Status na mesma linha
                st.markdown(f"<div><span class='nome-pet'>{pet['Nome_Pet']}</span><span class='tag-status'>PERDIDO</span></div>", unsafe_allow_html=True)
                
                # Informações Compactas
                st.markdown(f"""
                <div class='info-container'>
                    <span class='info-label'>{label_loc}</span> <span class='info-valor'>{valor_loc}</span><br>
                    <span class='info-label'>🐾 Info:</span> <span class='info-valor'>{pet['Especie']} | {pet['Raca']} ({pet['Cor']})</span>
                </div>
                """, unsafe_allow_html=True)
                
                st.write("") # Pequeno respiro
                
                # Botões em Colunas Estreitas
                b1, b2, b3 = st.columns(3)
                with b1:
                    if st.button("👁️ Vi!", key=f"vi_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; ir_para('novo_avistamento')
                with b2:
                    if st.button("🔍 Foto", key=f"f_{p_id}", use_container_width=True):
                        st.session_state.pagina_detalhes = pet['Foto']; st.rerun()
                with b3:
                    if st.button("🗺️ Rota", key=f"r_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; ir_para('historico_pet')
                
                if st.session_state.logado:
                    tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                    st.link_button("🟢 WhatsApp Tutor", f"https://wa.me/55{tel}", use_container_width=True)

# PÁGINA: CADASTRO USER
elif st.session_state.pagina == 'cadastro_user':
    st.markdown("### 📝 Criar Conta")
    if st.button("⬅️ Voltar"): ir_para('home')
    with st.form("cad"):
        n = st.text_input("Nome Completo")
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        t = st.text_input("WhatsApp")
        if st.form_submit_button("CADASTRAR"):
            novo = pd.DataFrame([{"Usuario":u, "Senha":p, "Nome":n, "Telefone":t}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha(ABA_USUARIOS), novo], ignore_index=True))
            st.success("Conta criada! Use o menu lateral para entrar."); st.balloons()
