import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 
ABA_AVISTAMENTOS = "Avistamentos"

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None
if 'pet_foco' not in st.session_state: st.session_state.pet_foco = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÕES GLOBAIS ---
def ler_planilha_direto(nome_aba):
    try:
        df = conn.read(worksheet=nome_aba, ttl=15, dtype=str)
        df = df.dropna(how='all')
        df.columns = df.columns.str.strip()
        df = df.fillna("")
        for col in df.columns:
            if col not in ['Lat', 'Lng']:
                df[col] = df[col].astype(str).str.replace(r'\.0$', '', regex=True).replace('nan', '')
        return df
    except Exception as e:
        st.error(f"Erro ao conectar com a planilha: {e}")
        return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if arquivo:
        try:
            url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
            img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
            payload = {"image": img_b64}
            response = requests.post(url, data=payload)
            data = response.json()
            if data.get("status") == 200: return data["data"]["url"]
        except Exception as e: pass
    return ""

def valor_seguro(linha, coluna):
    pet_dict = dict(linha)
    col_buscada = coluna.lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '').replace('\n', '').replace('\r', '')
    for chave, valor in pet_dict.items():
        chave_limpa = str(chave).lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '').replace('\n', '').replace('\r', '').strip()
        if chave_limpa == col_buscada:
            v = str(valor).strip()
            if v and v.lower() not in ['nan', 'none', '']: return v
    return '-'

def obter_endereco(lat, lng):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=16"
        headers = {'User-Agent': 'PetAlertaSCS_App/1.0'}
        resp = requests.get(url, headers=headers, timeout=4)
        if resp.status_code == 200:
            dados = resp.json()
            end = dados.get('address', {})
            rua = end.get('road', '')
            bairro = end.get('suburb', end.get('neighbourhood', ''))
            if rua and bairro: return f"{rua}, {bairro}"
            if rua: return rua
            if bairro: return bairro
            display = dados.get('display_name', '')
            return display.split(',')[0] if display else "Localização no mapa"
    except: pass
    return "Localização no mapa"

# --- CSS AGRESSIVO (Força Fundo Branco e Títulos Colados) ---
st.markdown("""
<style>
    /* Força o contêiner a ser branco e as letras pretas */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: #FFFFFF !important;
        color: #000000 !important;
        border-radius: 12px !important;
    }
    
    /* Título do Card ultra colado */
    .titulo-card {
        color: #000000 !important;
        margin: 0px !important;
        padding: 0px !important;
        line-height: 1.0 !important;
        font-size: 1.3rem !important;
        font-weight: bold !important;
    }
    
    /* Texto do corpo do card */
    .texto-card {
        color: #000000 !important;
        margin: 2px 0px !important;
        font-size: 0.95rem !important;
        line-height: 1.2 !important;
    }

    .foto-card {
        width: 120px !important;
        height: 120px !important;
        object-fit: cover !important;
        border-radius: 10px !important;
        border: 1px solid #ccc !important;
    }
    
    .avistamento-alerta {
        color: #d35400 !important;
        font-weight: bold !important;
    }
</style>
""", unsafe_allow_html=True)

def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, width='stretch')
    if st.button("⬅️ VOLTAR", width='stretch', type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.stop()

# --- SIDEBAR ---
with st.sidebar:
    st.title("🐾 Menu")
    if st.button("🏠 Início (Mural)", width='stretch'): ir_para('home')
    if st.button("🏆 Hall da Fama", width='stretch'): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        st.subheader("Entrar")
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", width='stretch', type="primary"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            user_found = None
            if not df_u.empty:
                for _, r in df_u.iterrows():
                    db_p = str(r.get('Senha', '')).replace('.0', '')
                    if str(r.get('Usuario', '')).lower() == u_l.strip().lower() and db_p == p_l.strip():
                        user_found = r.to_dict()
                        break
            if user_found:
                st.session_state.logado, st.session_state.user = True, user_found
                st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", width='stretch'): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user.get('Nome', 'Usuário').split()[0]}")
        if st.button("🐾 Meus Pets", width='stretch'): ir_para('meus_pets')
        if st.button("🚪 Sair", width='stretch'):
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    if not df_avis.empty: df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if valor_seguro(pet, 'Status') == 'Perdido':
                    esp = valor_seguro(pet, 'Especie').lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    lat_v, lng_v = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
                    if lat_v != '-' and lng_v != '-':
                        folium.Marker([float(lat_v), float(lng_v)], popup=f"<b>{valor_seguro(pet, 'Nome_Pet')}</b>", icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width='stretch', height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR NOVO PET", type="primary", width='stretch'): ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                
                # --- INÍCIO DO CARD AGRUPADO ---
                with st.container(border=True):
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    foto_src = valor_seguro(pet, 'Foto')
                    nome_pet = valor_seguro(pet, 'Nome_Pet')
                    
                    loc_texto = f"📍 <b>Sumiu em:</b> {valor_seguro(pet, 'Local_Desaparecimento')} ({valor_seguro(pet, 'Data')})"
                    tem_avistamento = False
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            tem_avistamento = True
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            loc_texto = f"<span class='avistamento-alerta'>🚨 Último avistamento:</span> {ultimo_avis.get('Bairro', '')} ({ultimo_avis.get('Data_Hora', '')})"
                    
                    # HTML COM CORES FORÇADAS (Inline Styles)
                    st.markdown(f'''
                        <div style="display: flex; gap: 15px; align-items: flex-start; background-color: white; padding: 5px; border-radius: 10px;">
                            <img src="{foto_src}" class="foto-card" onerror="this.style.display='none'">
                            <div style="flex: 1;">
                                <h3 class="titulo-card" style="color: black !important;">{nome_pet}</h3>
                                <p class="texto-card" style="color: black !important;"><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p class="texto-card" style="color: black !important;"><b>Cor:</b> {valor_seguro(pet, 'Cor')}</p>
                                <p class="texto-card" style="color: black !important;"><b>Características:</b> {valor_seguro(pet, 'Caracteristicas')}</p>
                                <p class="texto-card" style="color: black !important; margin-top: 5px !important;">{loc_texto}</p>
                            </div>
                        </div>
                    ''', unsafe_allow_html=True)
                    
                    # BOTÕES DENTRO DO CARD
                    if st.session_state.logado:
                        c1, c2, c3, c4 = st.columns(4)
                        with c1:
                            if foto_src and st.button("🔍 Foto", key=f"zf_{pet_id}", width='stretch'):
                                st.session_state.pagina_detalhes = foto_src
                                st.rerun()
                        with c2:
                            tel_bruto = valor_seguro(pet, 'Tel_Tutor')
                            if tel_bruto == '-': tel_bruto = valor_seguro(pet, 'Telefone_Tutor')
                            tel = "".join(filter(str.isdigit, tel_bruto))
                            if len(tel) >= 10: st.link_button("🟢 Whats", f"https://wa.me/55{tel}", width='stretch')
                            else: st.button("🚫 Whats", disabled=True, key=f"w_{pet_id}", width='stretch')
                        with c3:
                            if st.button("👁️ Vi!", key=f"avi_{pet_id}", width='stretch'):
                                st.session_state.pet_foco = dict(pet)
                                ir_para('novo_avistamento')
                        with c4:
                            if tem_avistamento:
                                if st.button("🗺️ Rota", key=f"rota_{pet_id}", width='stretch'):
                                    st.session_state.pet_foco = dict(pet)
                                    ir_para('historico_pet')
                            else: st.button("🗺️ Rota", disabled=True, key=f"rd_{pet_id}", width='stretch')
                    else:
                        c1, c2 = st.columns(2)
                        with c1:
                            if st.button("🔍 Ver Foto", key=f"zf_{pet_id}", width='stretch'):
                                st.session_state.pagina_detalhes = foto_src
                                st.rerun()
                        with c2: st.button("🔒 Login p/ Contato", disabled=True, key=f"log_{pet_id}", width='stretch')
                st.write("") 

# --- PÁGINA: REGISTRAR AVISTAMENTO ---
elif st.session_state.pagina == 'novo_avistamento':
    pet = st.session_state.pet_foco
    st.header(f"👁️ Vi o pet: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')
    m_avi = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_avi)
    map_res = st_folium(m_avi, width=700, height=300, key="map_avi")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()
    with st.form("f_avis"):
        bairro_avi = st.text_input("Local (Ponto de Referência)")
        obs_avi = st.text_area("Observações")
        if st.form_submit_button("📍 SALVAR"):
            if st.session_state.temp_lat:
                with st.spinner("Salvando..."):
                    end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                    novo_avi = {
                        "ID_Pet": valor_seguro(pet, 'ID'), "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'),
                        "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng),
                        "Bairro": f"{end_r} - {bairro_avi}" if bairro_avi else end_r,
                        "Observacao": obs_avi, "Usuario": st.session_state.user.get('Usuario', '')
                    }
                    df_av = ler_planilha_direto(ABA_AVISTAMENTOS)
                    conn.update(worksheet=ABA_AVISTAMENTOS, data=pd.concat([df_av, pd.DataFrame([novo_avi])], ignore_index=True))
                    st.cache_data.clear()
                    st.session_state.temp_lat = None
                    ir_para('home')

# --- PÁGINA: ROTA ---
elif st.session_state.pagina == 'historico_pet':
    pet = st.session_state.pet_foco
    st.header(f"🗺️ Rota: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    avis_deste = df_avis[df_avis['ID_Pet'] == str(valor_seguro(pet, 'ID')).strip()]
    if not avis_deste.empty:
        l_o, n_o = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
        m_h = folium.Map(location=[float(l_o), float(n_o)], zoom_start=14)
        pontos = [[float(l_o), float(n_o)]]
        folium.Marker([float(l_o), float(n_o)], icon=folium.Icon(color='black')).add_to(m_h)
        for _, av in avis_deste.iterrows():
            pontos.append([float(av['Lat']), float(av['Lng'])])
            folium.Marker([float(av['Lat']), float(av['Lng'])], icon=folium.Icon(color='red')).add_to(m_h)
        folium.PolyLine(pontos, color="red").add_to(m_h)
        st_folium(m_h, width='stretch', height=400)

# --- PÁGINA: HALL DA FAMA ---
elif st.session_state.pagina == 'hall_fama':
    st.title("🏆 Hall da Fama")
    df = ler_planilha_direto(ABA_PETS)
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Encontrado':
                with st.container(border=True):
                    st.markdown(f'''
                        <div style="display: flex; gap: 15px; background-color: white; padding: 10px; border-radius: 10px;">
                            <img src="{valor_seguro(pet, 'Foto')}" class="foto-card">
                            <div>
                                <h3 style="color: #27ae60 !important; margin:0;">🎉 {valor_seguro(pet, 'Nome_Pet')}</h3>
                                <p style="color: black !important; margin: 5px 0;">Já está em casa com sua família! ❤️</p>
                            </div>
                        </div>
                    ''', unsafe_allow_html=True)

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Pet Perdido")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()
    with st.form("f_pet"):
        n_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca, cor, caract = st.text_input("Raça"), st.text_input("Cor"), st.text_area("Características")
        bairro = st.text_input("Bairro/Referência")
        foto = st.file_uploader("Foto")
        if st.form_submit_button("🚀 PUBLICAR"):
            if n_p and st.session_state.temp_lat:
                url_f = fazer_upload_imgbb(foto)
                end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                u = st.session_state.user
                d = {
                    "ID": str(int(datetime.now().timestamp())), "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'),
                    "Especie": esp, "Nome_Pet": n_p, "Raca": raca, "Cor": cor, "Caracteristicas": caract, 
                    "Local_Desaparecimento": f"{end_r} - {bairro}" if bairro else end_r,
                    "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng), "Foto": url_f,
                    "User_Vinculo": u.get('Usuario', ''), "Tel_Tutor": u.get('Telefone', '')
                }
                df_p = ler_planilha_direto(ABA_PETS)
                conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, pd.DataFrame([d])], ignore_index=True))
                st.cache_data.clear()
                ir_para('home')

# --- PÁGINA: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Minhas Publicações")
    df = ler_planilha_direto(ABA_PETS)
    u_log = str(st.session_state.user.get('Usuario', '')).lower()
    meus = df[df.apply(lambda r: str(r.get('User_Vinculo', '')).lower() == u_log, axis=1)]
    for idx, pet in meus.iterrows():
        with st.container(border=True):
            st.subheader(valor_seguro(pet, 'Nome_Pet'))
            if valor_seguro(pet, 'Status') == 'Perdido':
                if st.button("🎉 MARCAR COMO ENCONTRADO", key=f"enc_{idx}", type="primary", width='stretch'):
                    df.loc[idx, 'Status'] = 'Encontrado'
                    conn.update(worksheet=ABA_PETS, data=df)
                    st.cache_data.clear()
                    st.rerun()

# --- PÁGINA: CADASTRO USER ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad"):
        n, t, u, p = st.text_input("Nome"), st.text_input("Whats"), st.text_input("User"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u,"Senha":p,"Telefone":t,"Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.cache_data.clear()
            ir_para('home')
