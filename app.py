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
        except Exception as e:
            pass
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
    except:
        pass
    return "Localização no mapa"

# --- INJEÇÃO DE CSS BLINDADO (FORÇANDO COR PRETA) ---
st.markdown("""
<style>
    .pet-card { border: 2px solid #ddd; border-radius: 12px; margin-bottom: 25px; background-color: #fff; box-shadow: 3px 3px 10px rgba(0,0,0,0.1); overflow: hidden; }
    .pet-card-encontrado { border: 2px solid #2ecc71; border-radius: 12px; margin-bottom: 25px; background-color: #f4fff8; box-shadow: 3px 3px 10px rgba(46, 204, 113, 0.2); overflow: hidden; }
    .pet-card-header { background-color: #f8f9fa; padding: 12px 18px; border-bottom: 2px solid #eee; }
    .pet-card-header h3 { color: #000000 !important; margin: 0; font-size: 1.5rem; }
    .pet-card-header-encontrado { background-color: #e8f8f5; padding: 12px 18px; border-bottom: 2px solid #2ecc71; }
    .pet-card-header-encontrado h3 { color: #27ae60 !important; margin: 0; font-size: 1.5rem; }
    
    .pet-card-body { display: flex; gap: 15px; padding: 15px; flex-wrap: wrap; }
    .pet-card-foto { width: 150px; height: 150px; object-fit: cover; border-radius: 10px; border: 1px solid #ddd; cursor: pointer; }
    .pet-card-info { flex: 1; min-width: 200px; }
    .pet-card-info p { margin: 4px 0; font-size: 1rem; color: #000000 !important; }
    
    .pet-card-footer { background: #fafafa; padding: 10px 15px; border-top: 1px solid #eee; }
    .pet-card-footer p, .pet-card-footer b, .pet-card-footer span { color: #000000 !important; margin: 0; }
    .avistamento-destaque { color: #d35400 !important; font-weight: bold; }
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

# ==========================================
# ROTAS DE PÁGINAS
# ==========================================

# --- PÁGINA: HOME (MURAL DE PERDIDOS) ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    
    df = ler_planilha_direto(ABA_PETS)
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)

    if not df_avis.empty and 'ID_Pet' in df_avis.columns:
        df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if valor_seguro(pet, 'Status') == 'Perdido':
                    esp = valor_seguro(pet, 'Especie').lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    nome_mapa = valor_seguro(pet, 'Nome_Pet')
                    nome_mapa = "Pet" if nome_mapa == '-' else nome_mapa
                    
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    lat_v = valor_seguro(pet, 'Lat')
                    lng_v = valor_seguro(pet, 'Lng')
                    local_mapa = valor_seguro(pet, 'Local_Desaparecimento')
                    
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            lat_v = ultimo_avis['Lat']
                            lng_v = ultimo_avis['Lng']
                            local_mapa = f"Último avistamento: {ultimo_avis['Bairro']}"
                            icon_c = 'red'

                    if lat_v != '-' and lng_v != '-':
                        folium.Marker([float(lat_v), float(lng_v)], 
                                      popup=f"<b>{nome_mapa}</b><br>📍 {local_mapa}", 
                                      icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width='stretch', height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", width='stretch'):
            ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        tem_perdido = False
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                tem_perdido = True
                pet_id = str(valor_seguro(pet, 'ID')).strip()
                foto_src = valor_seguro(pet, 'Foto')
                if foto_src == '-': foto_src = ""
                nome_pet = valor_seguro(pet, 'Nome_Pet')
                nome_pet = "Pet sem nome" if nome_pet == '-' else nome_pet
                
                rodape_texto = f"📍 <b>Sumiu em:</b> {valor_seguro(pet, 'Local_Desaparecimento')} (Data: {valor_seguro(pet, 'Data')})"
                tem_avistamento = False
                
                if not df_avis.empty:
                    avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                    if not avis_deste_pet.empty:
                        tem_avistamento = True
                        ultimo_avis = avis_deste_pet.iloc[-1]
                        rodape_texto = f"🚨 <span class='avistamento-destaque'>Último avistamento:</span> {ultimo_avis.get('Bairro', '')} (Em {ultimo_avis.get('Data_Hora', '')})"
                
                st.markdown(f'''
                    <div class="pet-card">
                        <div class="pet-card-header"><h3>{nome_pet}</h3></div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p><b>Cor:</b> {valor_seguro(pet, 'Cor')}</p>
                                <p><b>Características:</b> {valor_seguro(pet, 'Caracteristicas')}</p>
                            </div>
                        </div>
                        <div class="pet-card-footer"><p>{rodape_texto}</p></div>
                    </div>
                ''', unsafe_allow_html=True)
                
                # --- LÓGICA DE BOTÕES SEGURA E RESTRITA ---
                if st.session_state.logado:
                    col_botoes = st.columns(4)
                    
                    with col_botoes[0]:
                        if foto_src and st.button("🔍 Ver Foto", key=f"zf_{pet_id}", width='stretch'):
                            st.session_state.pagina_detalhes = foto_src
                            st.rerun()
                            
                    with col_botoes[1]:
                        tel_bruto = valor_seguro(pet, 'Tel_Tutor')
                        if tel_bruto == '-': tel_bruto = valor_seguro(pet, 'Telefone_Tutor')
                        tel = "".join(filter(str.isdigit, tel_bruto))
                        if len(tel) >= 10: 
                            st.link_button("🟢 Whats", f"https://wa.me/55{tel}", width='stretch')
                        else:
                            st.button("🚫 S/ Contato", disabled=True, key=f"w_{pet_id}", width='stretch')
                            
                    with col_botoes[2]:
                        if st.button("👁️ Vi este pet!", key=f"avi_{pet_id}", width='stretch'):
                            st.session_state.pet_foco = dict(pet)
                            ir_para('novo_avistamento')
                            
                    with col_botoes[3]:
                        if tem_avistamento:
                            if st.button("🗺️ Rota", key=f"rota_{pet_id}", width='stretch'):
                                st.session_state.pet_foco = dict(pet)
                                ir_para('historico_pet')
                        else:
                            st.button("🗺️ Rota", disabled=True, key=f"rota_dis_{pet_id}", help="Sem avistamentos", width='stretch')
                
                else: # Usuário DESLOGADO (Só vê foto e cadeado)
                    col_botoes = st.columns(2)
                    with col_botoes[0]:
                        if foto_src and st.button("🔍 Ver Foto", key=f"zf_{pet_id}", width='stretch'):
                            st.session_state.pagina_detalhes = foto_src
                            st.rerun()
                    with col_botoes[1]:
                        st.button("🔒 Login p/ Contato", disabled=True, key=f"log_{pet_id}", width='stretch')
                st.write("")
        if not tem_perdido: st.info("Nenhum pet desaparecido no momento! 🎉")

# --- PÁGINA: REGISTRAR AVISTAMENTO ---
elif st.session_state.pagina == 'novo_avistamento':
    pet = st.session_state.pet_foco
    st.header(f"👁️ Informar avistamento de {valor_seguro(pet, 'Nome_Pet')}")
    st.write("Mova o mapa e clique no local exato onde você viu este pet recentemente.")
    
    if st.button("⬅️ Cancelar e Voltar", width='stretch'): ir_para('home')

    m_avi = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_avi)
    
    map_res = st_folium(m_avi, width=700, height=300, key="map_avi")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat = map_res["last_clicked"]["lat"]
        st.session_state.temp_lng = map_res["last_clicked"]["lng"]
        st.rerun()

    with st.form("f_avis"):
        bairro_avi = st.text_input("Complemento do Local (Opcional)")
        obs_avi = st.text_area("Observações (Ex: Estava mancando, correu para um beco...)")
        
        if st.form_submit_button("📍 SALVAR AVISTAMENTO", type="primary"):
            if st.session_state.temp_lat:
                with st.spinner("Buscando endereço da rua e salvando avistamento..."):
                    endereco_rua = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                    local_final = f"{endereco_rua} - {bairro_avi}" if bairro_avi else endereco_rua
                    
                    novo_avi = {
                        "ID_Pet": valor_seguro(pet, 'ID'),
                        "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'),
                        "Lat": str(st.session_state.temp_lat),
                        "Lng": str(st.session_state.temp_lng),
                        "Bairro": local_final,
                        "Observacao": obs_avi,
                        "Usuario": st.session_state.user.get('Usuario', '')
                    }
                    try:
                        df_av = ler_planilha_direto(ABA_AVISTAMENTOS)
                        df_final_av = pd.concat([df_av, pd.DataFrame([novo_avi])], ignore_index=True)
                        conn.update(worksheet=ABA_AVISTAMENTOS, data=df_final_av)
                        st.cache_data.clear()
                        st.session_state.temp_lat = None
                        st.success("✅ Avistamento registrado! O endereço foi capturado automaticamente.")
                        ir_para('home')
                    except Exception as e:
                        st.error(f"Erro ao salvar: {e}")
            else:
                st.error("Por favor, clique no mapa para marcar o local.")

# --- PÁGINA: HISTÓRICO/ROTA DO PET ---
elif st.session_state.pagina == 'historico_pet':
    pet = st.session_state.pet_foco
    st.header(f"🗺️ Rota de Avistamentos: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar ao Mural", width='stretch'): ir_para('home')

    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    if not df_avis.empty and 'ID_Pet' in df_avis.columns:
        df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()
    
    avis_deste_pet = df_avis[df_avis['ID_Pet'] == str(valor_seguro(pet, 'ID')).strip()] if not df_avis.empty else pd.DataFrame()

    if not avis_deste_pet.empty:
        lat_orig, lng_orig = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
        m_hist = folium.Map(location=[float(lat_orig), float(lng_orig)], zoom_start=14)
        pontos_rota = [[float(lat_orig), float(lng_orig)]]
        
        folium.Marker([float(lat_orig), float(lng_orig)], popup="<b>Onde desapareceu</b>", icon=folium.Icon(color='black', icon='home', prefix='fa')).add_to(m_hist)
        
        for i, av in avis_deste_pet.iterrows():
            lat_a, lng_a = float(av['Lat']), float(av['Lng'])
            pontos_rota.append([lat_a, lng_a])
            folium.Marker([lat_a, lng_a], popup=f"<b>Avistamento</b><br>{av['Bairro']}<br>{av['Data_Hora']}<br><i>{av['Observacao']}</i>", icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_hist)
            
        folium.PolyLine(pontos_rota, color="red", weight=2.5, opacity=0.8).add_to(m_hist)
        st_folium(m_hist, width='stretch', height=400)
        
        st.subheader("Registros:")
        for _, av in avis_deste_pet.iterrows():
            st.info(f"📍 **{av['Data_Hora']} - {av['Bairro']}**\n\n_{av['Observacao']}_ (Relatado por: {av['Usuario']})")
    else: st.warning("Nenhum histórico encontrado.")

# --- PÁGINA: HALL DA FAMA ---
elif st.session_state.pagina == 'hall_fama':
    st.title("🏆 Hall da Fama")
    st.write("Aqui celebramos os finais felizes! Estes pets já voltaram para suas famílias em Santa Cruz do Sul. ❤️")
    df = ler_planilha_direto(ABA_PETS)
    if not df.empty:
        tem_encontrado = False
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Encontrado':
                tem_encontrado = True
                foto_src = valor_seguro(pet, 'Foto')
                if foto_src == '-': foto_src = ""
                st.markdown(f'''
                    <div class="pet-card-encontrado">
                        <div class="pet-card-header-encontrado"><h3>🎉 {valor_seguro(pet, 'Nome_Pet')}</h3></div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p style="color: #27ae60 !important; font-weight: bold; margin-top: 10px;">Graças à comunidade, este pet não está mais perdido!</p>
                            </div>
                        </div>
                    </div>
                ''', unsafe_allow_html=True)
                if foto_src and st.button("🔍 Ver Foto", key=f"z_{valor_seguro(pet, 'ID')}", width='stretch'):
                    st.session_state.pagina_detalhes = foto_src
                    st.rerun()
                st.write("")
        if not tem_encontrado: st.info("Ainda não temos pets encontrados registrados.")
    else: st.info("Nenhum dado encontrado.")

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal Perdido")
    st.info("Clique no mapa para marcar o local.")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca, cor = st.text_input("Raça"), st.text_input("Cor Principal")
        caract = st.text_area("Características marcantes")
        bairro = st.text_input("Complemento do Local (Opcional)")
        foto = st.file_uploader("Foto do Pet")
        
        if st.form_submit_button("🚀 PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                with st.spinner("Buscando endereço no mapa e salvando dados..."):
                    url_foto = fazer_upload_imgbb(foto) if foto else ""
                    endereco_rua = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                    local_final = f"{endereco_rua} - {bairro}" if bairro else endereco_rua
                    
                    u = st.session_state.user
                    dados_novos = {
                        "ID": str(int(datetime.now().timestamp())),
                        "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'),
                        "Especie": esp, "Nome_Pet": nome_p, "Raca": raca, "Cor": cor,
                        "Caracteristicas": caract, "Local_Desaparecimento": local_final,
                        "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng),
                        "Foto": url_foto, "Nome_Tutor": u.get('Nome', ''), "Tel_Tutor": u.get('Telefone', ''),
                        "User_Vinculo": u.get('Usuario', ''), "Nascimento_Tutor": u.get('Nascimento', ''),
                        "Telefone_Tutor": u.get('Telefone', ''), "Email_Tutor": u.get('Email', ''), "Endereco_Tutor": u.get('Endereco', '')
                    }
                    try:
                        df_p = ler_planilha_direto(ABA_PETS)
                        df_final = pd.concat([df_p, pd.DataFrame([dados_novos])], ignore_index=True)
                        conn.update(worksheet=ABA_PETS, data=df_final)
                        st.cache_data.clear()
                        st.session_state.temp_lat = None
                        st.success("✅ Pet cadastrado com sucesso!")
                        ir_para('home')
                    except Exception as e: st.error(f"Erro ao salvar: {e}")
            else: st.error("Preencha o nome e marque o local no mapa.")

# --- PÁGINA: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Meus Pets Cadastrados")
    if not st.session_state.logado:
        st.warning("Você precisa estar logado para ver seus pets.")
        st.stop()
    df = ler_planilha_direto(ABA_PETS)
    if df.empty:
        st.info("O sistema ainda não possui nenhum pet cadastrado.")
    else:
        usuario_logado = str(st.session_state.user.get('Usuario', '')).strip().lower()
        def eh_meu_pet(linha):
            return str(linha.get('User_Vinculo', '')).strip().lower() == usuario_logado
        meus_pets = df[df.apply(eh_meu_pet, axis=1)]
        if meus_pets.empty:
            st.info("Você ainda não cadastrou nenhum pet desaparecido.")
        else:
            for idx, pet in meus_pets.iterrows():
                pet_id, nome_pet = str(valor_seguro(pet, 'ID')).strip(), valor_seguro(pet, 'Nome_Pet')
                if nome_pet == '-': nome_pet = "Pet sem nome"
                status_atual, foto_src = valor_seguro(pet, 'Status'), valor_seguro(pet, 'Foto')
                cor = "green" if status_atual == "Encontrado" else "red"
                with st.container(border=True):
                    c1, c2 = st.columns([1, 3])
                    with c1:
                        if foto_src and foto_src != '-': st.image(foto_src, width='stretch')
                        else: st.write("📷 Sem foto")
                    with c2:
                        st.subheader(nome_pet)
                        st.markdown(f"**Status:** :{cor}[**{status_atual}**]")
                        st.write(f"**Registrado em:** {valor_seguro(pet, 'Data')}")
                        if status_atual == 'Perdido':
                            if st.button("🎉 MARCAR COMO ENCONTRADO", key=f"btn_enc_{pet_id}", type="primary", width='stretch'):
                                with st.spinner("Atualizando banco de dados..."):
                                    try:
                                        df.loc[df['ID'] == pet_id, 'Status'] = 'Encontrado'
                                        conn.update(worksheet=ABA_PETS, data=df)
                                        st.cache_data.clear()
                                        st.success(f"Que maravilha! {nome_pet} foi marcado como Encontrado!")
                                        st.rerun()
                                    except Exception as e: st.error(f"Erro: {e}")

# --- PÁGINA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad_u"):
        n, t, e, u_cad, p_cad = st.text_input("Nome"), st.text_input("WhatsApp"), st.text_input("Email"), st.text_input("Usuário"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u_cad,"Senha":p_cad,"Nivel":"Membro","Telefone":t,"Email":e,"Nascimento":"","Endereco":"","Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.cache_data.clear()
            st.success("Conta criada!")
            ir_para('home')
